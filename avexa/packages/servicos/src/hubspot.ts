import type { Db } from '@avexa/db'
import {
  configHubspotDoAmbiente,
  garantirPropriedades,
  infoDoTokenHubspot,
  renovarHubspot,
  statusDeLead,
  trocarCodigoHubspot,
  urlDeConsentimentoHubspot,
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

/** Qual `hs_lead_status` mandar. Nulo quando o portal não deu opção nenhuma:
 *  melhor gravar o contato sem status do que derrubar a entrega. */
export function statusParaGravar(
  config: Record<string, unknown>,
  qualificado: boolean,
): string | null {
  const v = qualificado ? config.statusQualificado : config.statusNaoQualificado
  return typeof v === 'string' && v ? v : null
}
