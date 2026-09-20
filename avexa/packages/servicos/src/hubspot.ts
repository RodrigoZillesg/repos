import type { Db } from '@avexa/db'
import {
  configHubspotDoAmbiente,
  criarPipeline,
  garantirPropriedades,
  infoDoTokenHubspot,
  listarPipelines,
  renovarHubspot,
  statusDeLead,
  temEscoposDeNegocios,
  trocarCodigoHubspot,
  urlDeConsentimentoHubspot,
  type NovoEstagio,
  type PipelineHubspot,
} from '@avexa/adapters'
import {
  conexaoValida,
  montarState,
  removerIntegracao,
  salvarCredenciais,
  type Conexao,
  type FalhaConexao,
} from './oauth.ts'

/** HubSpot por cliente.
 *
 *  A conexão faz mais do que guardar token: cria as propriedades da Avexa no
 *  portal e lê as opções de `hs_lead_status` que aquele portal usa. As duas
 *  coisas são a diferença entre a primeira entrega funcionar e a primeira
 *  entrega devolver 400 com um lead quente na mão. */

export function hubspotConfigurado(): boolean {
  return configHubspotDoAmbiente() !== null && (process.env.APP_SECRET ?? '').length >= 32
}

export function urlParaConectarHubspot(clienteId: string): string | null {
  const cfg = configHubspotDoAmbiente()
  if (!cfg || !hubspotConfigurado()) return null
  return urlDeConsentimentoHubspot(cfg, montarState(clienteId, 'hubspot'))
}

export interface ResultadoConexaoHubspot {
  ok: boolean
  erro?: string
  /** O que não deu para preparar, mas não impede de conectar. */
  avisos?: string[]
}

export async function concluirConexaoHubspot(
  db: Db,
  clienteId: string,
  codigo: string,
): Promise<ResultadoConexaoHubspot> {
  const cfg = configHubspotDoAmbiente()
  if (!cfg) return { ok: false, erro: 'HubSpot não configurado neste ambiente' }

  const cred = await trocarCodigoHubspot(cfg, codigo)
  if ('erro' in cred) return { ok: false, erro: cred.erro }
  if (!cred.refreshToken) {
    return { ok: false, erro: 'O HubSpot não devolveu um refresh token. Comece de novo.' }
  }

  const avisos: string[] = []
  const info = await infoDoTokenHubspot(cred.accessToken)
  const extra: Record<string, unknown> = {}
  if ('erro' in info) {
    avisos.push('Não deu para identificar o portal conectado.')
  } else {
    extra.hubId = info.hubId
    extra.dominio = info.dominio ?? null
    extra.conta = info.dominio ?? String(info.hubId)
    // Os escopos concedidos, para a tela saber o que este portal deixa fazer.
    // Um portal conectado antes de pedirmos negócios continua válido para
    // contato e nota, e só o que depende do escopo novo fica indisponível.
    extra.escopos = info.escopos
    extra.negociosOk = temEscoposDeNegocios(info.escopos)
  }

  // Propriedades antes da primeira entrega, não durante.
  const props = await garantirPropriedades(cred.accessToken)
  if ('erro' in props) {
    avisos.push(
      `As propriedades da Avexa não puderam ser criadas (${props.erro}). O contato será gravado sem score e resumo até isso ser resolvido.`,
    )
    extra.propriedadesOk = false
  } else {
    extra.propriedadesOk = true
  }

  const status = await statusDeLead(cred.accessToken)
  if ('erro' in status) {
    avisos.push('Não deu para ler as opções de status de lead deste portal.')
  } else {
    extra.statusDisponiveis = status
    // Palpite inicial entre as opções que ESTE portal tem, para o operador
    // ajustar. Nunca um valor inventado.
    const achar = (...nomes: string[]) =>
      nomes.map((n) => status.find((o) => o.valor === n)?.valor).find(Boolean) ?? null
    extra.statusQualificado = achar('OPEN_DEAL', 'CONNECTED', 'IN_PROGRESS', 'OPEN', 'NEW')
    extra.statusNaoQualificado = achar('UNQUALIFIED', 'BAD_TIMING', 'OPEN', 'NEW')
  }

  await salvarCredenciais(
    db,
    clienteId,
    'hubspot',
    {
      accessToken: cred.accessToken,
      refreshToken: cred.refreshToken,
      expiraEm: cred.expiraEm,
    },
    extra,
  )

  return { ok: true, ...(avisos.length > 0 ? { avisos } : {}) }
}

export async function conexaoHubspot(db: Db, clienteId: string): Promise<Conexao | FalhaConexao> {
  const cfg = configHubspotDoAmbiente()
  if (!cfg) return { erro: 'HubSpot não configurado neste ambiente' }
  return conexaoValida(db, clienteId, 'hubspot', async (refresh) => {
    const r = await renovarHubspot(cfg, refresh)
    if ('erro' in r) return { ok: false, erro: r.erro, ...(r.revogado ? { revogado: true } : {}) }
    return {
      ok: true,
      cred: {
        accessToken: r.accessToken,
        ...(r.refreshToken ? { refreshToken: r.refreshToken } : {}),
        expiraEm: r.expiraEm,
      },
    }
  })
}

export async function desconectarHubspot(db: Db, clienteId: string): Promise<void> {
  // O HubSpot revoga pelo próprio portal, em Conectados > Apps privados/
  // integrações. Apagamos o que temos de qualquer jeito.
  await removerIntegracao(db, clienteId, 'hubspot')
}

/* ------------------------------- Pipelines -------------------------------- */

/** Recado único para quando o portal recusa por falta de escopo.
 *  A mensagem precisa dizer o que fazer: "403" não diz. */
const FALTA_RECONECTAR =
  'Este portal foi conectado antes de a Avexa pedir acesso a negócios. Desconecte e conecte de novo para habilitar pipelines.'

export async function pipelinesDoCliente(
  db: Db,
  clienteId: string,
): Promise<PipelineHubspot[] | { erro: string }> {
  const conexao = await conexaoHubspot(db, clienteId)
  if ('erro' in conexao) return { erro: conexao.erro }
  if (conexao.config.negociosOk === false) return { erro: FALTA_RECONECTAR }

  const r = await listarPipelines(conexao.accessToken)
  if ('erro' in r) return { erro: r.semPermissao ? FALTA_RECONECTAR : r.erro }
  return r
}

/** Estágios com que um pipeline novo nasce.
 *
 *  É o funil de quem trabalha lead de saída: o lead entra qualificado, vira
 *  conversa, vira proposta, fecha ou não. O cliente renomeia no portal dele
 *  depois — o que importa é não criar um pipeline vazio, que não recebe
 *  negócio nenhum. */
export const ESTAGIOS_PADRAO: readonly NovoEstagio[] = [
  { rotulo: 'Lead qualificado', probabilidade: 0.2 },
  { rotulo: 'Reunião marcada', probabilidade: 0.4 },
  { rotulo: 'Proposta enviada', probabilidade: 0.6 },
  { rotulo: 'Ganho', probabilidade: 1, fechado: true },
  { rotulo: 'Perdido', probabilidade: 0, fechado: true },
]

/** Cria um pipeline no portal do cliente.
 *
 *  Escrita estrutural no CRM de outra empresa: sempre um gesto explícito do
 *  operador, nunca efeito colateral de uma entrega. */
export async function criarPipelineDoCliente(
  db: Db,
  clienteId: string,
  rotulo: string,
  estagios: readonly NovoEstagio[] = ESTAGIOS_PADRAO,
): Promise<PipelineHubspot | { erro: string }> {
  const conexao = await conexaoHubspot(db, clienteId)
  if ('erro' in conexao) return { erro: conexao.erro }
  if (conexao.config.negociosOk === false) return { erro: FALTA_RECONECTAR }

  const r = await criarPipeline(conexao.accessToken, rotulo, estagios)
  if ('erro' in r) return { erro: r.semPermissao ? FALTA_RECONECTAR : r.erro }
  return r
}

export interface DestinoNoFunil {
  pipeline: string
  estagio: string
}

/** Para qual pipeline e estágio este lead vai, ou `null` para não abrir
 *  negócio nenhum.
 *
 *  Lead não qualificado sem estágio configurado não entra no funil, de
 *  propósito: encher o pipeline do cliente de negócio que ninguém vai
 *  trabalhar estraga a previsão de vendas dele, que é o número que ele olha. */
export function funilParaGravar(
  config: Record<string, unknown>,
  qualificado: boolean,
): DestinoNoFunil | null {
  const pipeline = config.pipeline
  if (typeof pipeline !== 'string' || !pipeline) return null
  const e = qualificado ? config.estagioQualificado : config.estagioNaoQualificado
  if (typeof e !== 'string' || !e) return null
  return { pipeline, estagio: e }
}

/** Qual `hs_lead_status` mandar. Nulo quando o portal não deu opção nenhuma:
 *  melhor gravar o contato sem status do que derrubar a entrega. */
export function statusParaGravar(
  config: Record<string, unknown>,
  qualificado: boolean,
): string | null {
  const v = qualificado ? config.statusQualificado : config.statusNaoQualificado
  return typeof v === 'string' && v ? v : null
}
