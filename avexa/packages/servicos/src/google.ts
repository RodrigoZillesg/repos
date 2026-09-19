import { and, eq } from 'drizzle-orm'
import { integracao, type Db } from '@avexa/db'
import {
  ESCOPOS,
  acrescentarLinha,
  configGoogleDoAmbiente,
  criarEvento,
  garantirCabecalho,
  ocupados,
  renovarAcesso,
  revogar,
  trocarCodigo,
  urlDeConsentimento,
  type ConfigGoogle,
  type Credenciais,
} from '@avexa/adapters'
import { escolherConsultor, horariosLivres, type Intervalo, type LimitesMotor } from '@avexa/core'
import { assinar, cifrar, conferirAssinatura, decifrar } from './cripto.ts'

/** Integrações Google por cliente.
 *
 *  O refresh token fica cifrado na coluna `segredo`, amarrado ao cliente e ao
 *  tipo. O access token vive na config, em claro de propósito: ele expira em uma
 *  hora e cifrar o que já é efêmero só complica a renovação. */

export type TipoGoogle = 'google_calendar' | 'google_sheets'

const contexto = (clienteId: string, tipo: TipoGoogle) => `${clienteId}:${tipo}`

interface ConfigIntegracao {
  accessToken?: string
  expiraEm?: string
  escopos?: string[]
  conta?: string
  /** Calendar: agendas do time, em ordem de rodízio. */
  calendarios?: string[]
  /** Sheets: planilha e aba de destino. */
  planilhaId?: string
  aba?: string
  [chave: string]: unknown
}

/** Configurado quer dizer que dá para conectar E para guardar com segurança.
 *  Sem APP_SECRET não há como cifrar o refresh token, e oferecer o botão seria
 *  oferecer uma conexão que quebra depois do consentimento. */
export function googleConfigurado(): boolean {
  return configGoogleDoAmbiente() !== null && (process.env.APP_SECRET ?? '').length >= 32
}

/** Monta o endereço de consentimento com o `state` assinado.
 *
 *  O `state` carrega para qual cliente e qual integração o retorno pertence, e
 *  vai assinado: sem isso, qualquer um poderia induzir o retorno a conectar a
 *  própria conta Google ao cliente de outra pessoa. */
export function urlParaConectar(clienteId: string, tipo: TipoGoogle): string | null {
  const cfg = configGoogleDoAmbiente()
  if (!cfg || !googleConfigurado()) return null
  const state = assinar(JSON.stringify({ clienteId, tipo, em: Date.now() }))
  return urlDeConsentimento(cfg, ESCOPOS[tipo], state)
}

export function lerState(state: string | null): { clienteId: string; tipo: TipoGoogle } | null {
  const valor = conferirAssinatura(state)
  if (!valor) return null
  try {
    const o = JSON.parse(valor) as { clienteId?: string; tipo?: string; em?: number }
    if (!o.clienteId || (o.tipo !== 'google_calendar' && o.tipo !== 'google_sheets')) return null
    // Dez minutos: o consentimento é uma conversa curta, e um state velho
    // reaproveitado é um replay.
    if (!o.em || Date.now() - o.em > 10 * 60_000) return null
    return { clienteId: o.clienteId, tipo: o.tipo }
  } catch {
    return null
  }
}

async function gravar(
  db: Db,
  clienteId: string,
  tipo: TipoGoogle,
  cred: Credenciais,
  extra: Partial<ConfigIntegracao> = {},
): Promise<void> {
  const [existente] = await db
    .select()
    .from(integracao)
    .where(and(eq(integracao.clienteId, clienteId), eq(integracao.tipo, tipo)))
    .limit(1)

  const config: ConfigIntegracao = {
    ...((existente?.config as ConfigIntegracao) ?? {}),
    ...extra,
    accessToken: cred.accessToken,
    expiraEm: cred.expiraEm.toISOString(),
    escopos: cred.escopos,
  }

  // Só sobrescreve o refresh token quando veio um novo: a renovação devolve o
  // antigo, mas uma resposta sem ele não pode apagar o que temos.
  const segredo = cred.refreshToken
    ? cifrar(cred.refreshToken, contexto(clienteId, tipo))
    : (existente?.segredo ?? null)

  if (existente) {
    await db
      .update(integracao)
      .set({ config, segredo, ativo: true })
      .where(eq(integracao.id, existente.id))
  } else {
    await db.insert(integracao).values({
      clienteId,
      tipo,
      nome: tipo === 'google_calendar' ? 'Google Calendar' : 'Google Sheets',
      config,
      segredo,
      ativo: true,
    })
  }
}

/** Conclui o consentimento e guarda as credenciais. */
export async function concluirConexao(
  db: Db,
  clienteId: string,
  tipo: TipoGoogle,
  codigo: string,
): Promise<{ ok: boolean; erro?: string }> {
  const cfg = configGoogleDoAmbiente()
  if (!cfg) return { ok: false, erro: 'Google não configurado neste ambiente' }

  const cred = await trocarCodigo(cfg, codigo)
  if ('erro' in cred) return { ok: false, erro: cred.erro }
  if (!cred.refreshToken) {
    // Sem refresh token a conexão morre em uma hora e o cliente acha que está
    // conectado. Melhor recusar agora.
    return {
      ok: false,
      erro: 'O Google não devolveu um token de longa duração. Remova o acesso do Avexa na conta e conecte de novo.',
    }
  }

  await gravar(db, clienteId, tipo, cred)
  return { ok: true }
}

export interface Conexao {
  accessToken: string
  config: ConfigIntegracao
  integracaoId: string
}

/** Devolve um access token válido, renovando se preciso.
 *
 *  Quando o cliente revogou o acesso, desliga a integração em vez de tentar de
 *  novo a cada lead: renovar um token revogado nunca funciona, e insistir só
 *  enche o log. */
export async function conexaoValida(
  db: Db,
  clienteId: string,
  tipo: TipoGoogle,
): Promise<Conexao | { erro: string; precisaReconectar?: boolean }> {
  const cfg = configGoogleDoAmbiente()
  if (!cfg) return { erro: 'Google não configurado neste ambiente' }

  const [linha] = await db
    .select()
    .from(integracao)
    .where(
      and(eq(integracao.clienteId, clienteId), eq(integracao.tipo, tipo), eq(integracao.ativo, true)),
    )
    .limit(1)
  if (!linha) return { erro: 'integração não conectada', precisaReconectar: true }

  const config = (linha.config as ConfigIntegracao) ?? {}
  const expira = config.expiraEm ? new Date(config.expiraEm) : new Date(0)
  if (config.accessToken && expira > new Date()) {
    return { accessToken: config.accessToken, config, integracaoId: linha.id }
  }

  const refresh = decifrar(linha.segredo, contexto(clienteId, tipo))
  if (!refresh) {
    await db.update(integracao).set({ ativo: false }).where(eq(integracao.id, linha.id))
    return { erro: 'segredo ilegível — reconecte a conta', precisaReconectar: true }
  }

  const cred = await renovarAcesso(cfg, refresh)
  if ('erro' in cred) {
    if (cred.revogado) {
      await db.update(integracao).set({ ativo: false }).where(eq(integracao.id, linha.id))
      return { erro: 'o cliente revogou o acesso — reconecte a conta', precisaReconectar: true }
    }
    return { erro: cred.erro }
  }

  await gravar(db, clienteId, tipo, cred)
  return { accessToken: cred.accessToken, config, integracaoId: linha.id }
}

export async function desconectar(db: Db, clienteId: string, tipo: TipoGoogle): Promise<void> {
  const cfg = configGoogleDoAmbiente()
  const [linha] = await db
    .select()
    .from(integracao)
    .where(and(eq(integracao.clienteId, clienteId), eq(integracao.tipo, tipo)))
    .limit(1)
  if (!linha) return

  // Revoga no Google também: desligar só aqui deixaria o consentimento ativo na
  // conta do cliente, o que não é o que ele pediu ao clicar em desconectar.
  const refresh = decifrar(linha.segredo, contexto(clienteId, tipo))
  if (cfg && refresh) await revogar(cfg, refresh)

  await db.delete(integracao).where(eq(integracao.id, linha.id))
}

export async function definirDestino(
  db: Db,
  clienteId: string,
  tipo: TipoGoogle,
  extra: Partial<ConfigIntegracao>,
): Promise<void> {
  const [linha] = await db
    .select()
    .from(integracao)
    .where(and(eq(integracao.clienteId, clienteId), eq(integracao.tipo, tipo)))
    .limit(1)
  if (!linha) return
  await db
    .update(integracao)
    .set({ config: { ...((linha.config as ConfigIntegracao) ?? {}), ...extra } })
    .where(eq(integracao.id, linha.id))
}

/* ------------------------------ Casos de uso ------------------------------ */

export interface PedidoAgendamento {
  clienteId: string
  titulo: string
  descricao?: string
  duracaoMin: number
  lembreteMin?: number
  emailDoLead: string
  fusoDoLead: string
  limites: LimitesMotor
  /** A partir de quando procurar; padrão, agora. */
  de?: Date
  /** Rodízio entre consultores ou sempre a agenda principal. */
  rodizio: boolean
  agora?: Date
}

export type ResultadoAgendamento =
  | { ok: true; inicio: Date; fim: Date; consultor: string; link?: string; meet?: string }
  | { ok: false; erro: string; precisaReconectar?: boolean }

export async function agendarReuniao(
  db: Db,
  p: PedidoAgendamento,
): Promise<ResultadoAgendamento> {
  const conexao = await conexaoValida(db, p.clienteId, 'google_calendar')
  if ('erro' in conexao) {
    return {
      ok: false,
      erro: conexao.erro,
      ...(conexao.precisaReconectar ? { precisaReconectar: true } : {}),
    }
  }

  const calendarios = conexao.config.calendarios ?? []
  if (calendarios.length === 0) {
    return { ok: false, erro: 'nenhuma agenda escolhida para este cliente' }
  }

  const agora = p.agora ?? new Date()
  const de = p.de ?? agora
  // Duas semanas de horizonte: oferecer daqui a um mês não ajuda ninguém.
  const ate = new Date(de.getTime() + 14 * 86_400_000)

  const resposta = await ocupados(conexao.accessToken, calendarios, de, ate)
  if (!resposta.ok) return { ok: false, erro: resposta.erro }
  const livres = resposta.calendarios

  // Só entram no rodízio as agendas que o cliente de fato compartilhou.
  const disponiveis = Object.keys(livres)
  if (disponiveis.length === 0) {
    return { ok: false, erro: 'nenhuma das agendas configuradas está acessível' }
  }

  // Sem rodízio, um horário só serve se a agenda única estiver livre. Com
  // rodízio, a varredura ignora os ocupados e a colisão é conferida por
  // consultor logo abaixo — senão um horário em que só um dos três está ocupado
  // seria descartado para todos.
  const ocupadosNaVarredura: Intervalo[] = p.rodizio ? [] : Object.values(livres).flat()

  const horarios = horariosLivres({
    de,
    ate,
    duracaoMin: p.duracaoMin,
    ocupados: ocupadosNaVarredura,
    fuso: p.fusoDoLead,
    limites: p.limites,
    quantos: 10,
    folgaMin: 10,
  })

  for (const inicio of horarios) {
    const fim = new Date(inicio.getTime() + p.duracaoMin * 60_000)
    const consultor = p.rodizio
      ? escolherConsultor(disponiveis, livres, inicio, fim)
      : (disponiveis[0] ?? null)
    if (!consultor) continue

    const evento = await criarEvento(conexao.accessToken, {
      calendarId: consultor,
      titulo: p.titulo,
      ...(p.descricao ? { descricao: p.descricao } : {}),
      inicio,
      fim,
      fuso: p.fusoDoLead,
      convidados: [p.emailDoLead],
      ...(p.lembreteMin !== undefined ? { lembreteMin: p.lembreteMin } : {}),
      comMeet: true,
    })
    if ('erro' in evento) return { ok: false, erro: evento.erro }

    return {
      ok: true,
      inicio,
      fim,
      consultor,
      ...(evento.link ? { link: evento.link } : {}),
      ...(evento.meet ? { meet: evento.meet } : {}),
    }
  }

  return { ok: false, erro: 'nenhum horário livre nas próximas duas semanas' }
}

export const CABECALHO_PLANILHA = [
  'Recebido em',
  'Nome',
  'Telefone',
  'E-mail',
  'Score',
  'Motivo',
  'Resumo',
  'Etiquetas',
  'utm_source',
  'utm_campaign',
] as const

export async function registrarNaPlanilha(
  db: Db,
  clienteId: string,
  valores: readonly (string | number | null)[],
): Promise<{ ok: boolean; erro?: string }> {
  const conexao = await conexaoValida(db, clienteId, 'google_sheets')
  if ('erro' in conexao) return { ok: false, erro: conexao.erro }

  const planilhaId = conexao.config.planilhaId
  const aba = conexao.config.aba ?? 'Leads'
  if (!planilhaId) return { ok: false, erro: 'nenhuma planilha escolhida para este cliente' }

  await garantirCabecalho(conexao.accessToken, planilhaId, aba, CABECALHO_PLANILHA)
  const r = await acrescentarLinha(conexao.accessToken, planilhaId, aba, valores)
  return 'erro' in r ? { ok: false, erro: r.erro } : { ok: true }
}
