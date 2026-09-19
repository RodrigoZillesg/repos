import { createHmac, timingSafeEqual } from 'node:crypto'
import type { AdaptadorAgenda, PedidoReuniao, ReuniaoConfirmada, ResultadoReuniao } from '@avexa/core'
import { requisitar, type Buscar } from './http.ts'

/** Calendly (API v2).
 *
 *  Calendly não deixa ninguém marcar na agenda de outra pessoa pela API, e isso
 *  é decisão de produto deles, não limitação a contornar: quem escolhe o horário
 *  é sempre o convidado. Então este adaptador entrega um link de uso único e a
 *  confirmação chega depois, por webhook.
 *
 *  Os formatos abaixo seguem a API v2 documentada. Vale um teste de fumaça
 *  contra uma conta real antes de ligar para cliente: campo renomeado em API de
 *  terceiro é o tipo de coisa que só aparece em produção. */

const API = 'https://api.calendly.com'
const AUTH = 'https://auth.calendly.com'

export interface ConfigCalendly {
  clientId: string
  clientSecret: string
  redirectUri: string
  buscar?: Buscar
}

export interface CredenciaisCalendly {
  accessToken: string
  refreshToken?: string
  expiraEm: Date
  /** URI do usuário e da organização, que a API exige em quase toda chamada. */
  usuario?: string
  organizacao?: string
}

export function urlDeConsentimentoCalendly(cfg: ConfigCalendly, state: string): string {
  const p = new URLSearchParams({
    client_id: cfg.clientId,
    response_type: 'code',
    redirect_uri: cfg.redirectUri,
    state,
  })
  return `${AUTH}/oauth/authorize?${p.toString()}`
}

function lerToken(corpo: unknown, anterior?: string): CredenciaisCalendly | { erro: string } {
  const r = corpo as {
    access_token?: string
    refresh_token?: string
    expires_in?: number
    owner?: string
    organization?: string
    error?: string
    error_description?: string
  } | null

  if (!r?.access_token) return { erro: r?.error_description ?? r?.error ?? 'resposta sem access_token' }
  return {
    accessToken: r.access_token,
    ...(r.refresh_token ? { refreshToken: r.refresh_token } : anterior ? { refreshToken: anterior } : {}),
    expiraEm: new Date(Date.now() + ((r.expires_in ?? 7200) - 60) * 1000),
    ...(r.owner ? { usuario: r.owner } : {}),
    ...(r.organization ? { organizacao: r.organization } : {}),
  }
}

export async function trocarCodigoCalendly(
  cfg: ConfigCalendly,
  codigo: string,
): Promise<CredenciaisCalendly | { erro: string }> {
  const r = await requisitar(`${AUTH}/oauth/token`, {
    corpo: {
      grant_type: 'authorization_code',
      code: codigo,
      redirect_uri: cfg.redirectUri,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
    },
    ...(cfg.buscar ? { buscar: cfg.buscar } : {}),
  })
  if (!r.ok) return { erro: r.erro ?? '' }
  return lerToken(r.corpo)
}

export async function renovarCalendly(
  cfg: ConfigCalendly,
  refreshToken: string,
): Promise<CredenciaisCalendly | { erro: string; revogado?: boolean }> {
  const r = await requisitar(`${AUTH}/oauth/token`, {
    corpo: {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
    },
    ...(cfg.buscar ? { buscar: cfg.buscar } : {}),
  })
  if (!r.ok) {
    const e = r.corpo as { error?: string; error_description?: string } | null
    const revogado = e?.error === 'invalid_grant' || r.status === 401
    return { erro: e?.error_description ?? e?.error ?? r.erro ?? '', ...(revogado ? { revogado } : {}) }
  }
  return lerToken(r.corpo, refreshToken)
}

export interface TipoDeEvento {
  uri: string
  nome: string
  duracaoMin: number
  url: string
  ativo: boolean
}

/** Tipos de evento do usuário conectado — é entre eles que o operador escolhe
 *  qual o fluxo deve oferecer. */
export async function tiposDeEvento(
  accessToken: string,
  usuarioUri: string,
  buscar?: Buscar,
): Promise<TipoDeEvento[] | { erro: string }> {
  const r = await requisitar(
    `${API}/event_types?${new URLSearchParams({ user: usuarioUri, active: 'true', count: '50' })}`,
    { metodo: 'GET', cabecalhos: { authorization: `Bearer ${accessToken}` }, ...(buscar ? { buscar } : {}) },
  )
  if (!r.ok) return { erro: r.erro ?? '' }

  const c = r.corpo as {
    collection?: Array<{ uri?: string; name?: string; duration?: number; scheduling_url?: string; active?: boolean }>
  } | null

  return (c?.collection ?? [])
    .filter((e) => e.uri)
    .map((e) => ({
      uri: e.uri!,
      nome: e.name ?? '(sem nome)',
      duracaoMin: e.duration ?? 30,
      url: e.scheduling_url ?? '',
      ativo: e.active !== false,
    }))
}

/** Horários livres de um tipo de evento. A API aceita no máximo sete dias por
 *  chamada e recusa início no passado. */
export async function horariosCalendly(
  accessToken: string,
  tipoDeEventoUri: string,
  de: Date,
  ate: Date,
  buscar?: Buscar,
): Promise<Date[] | { erro: string }> {
  const inicio = new Date(Math.max(de.getTime(), Date.now() + 60_000))
  const fim = new Date(Math.min(ate.getTime(), inicio.getTime() + 6.5 * 86_400_000))

  const r = await requisitar(
    `${API}/event_type_available_times?${new URLSearchParams({
      event_type: tipoDeEventoUri,
      start_time: inicio.toISOString(),
      end_time: fim.toISOString(),
    })}`,
    { metodo: 'GET', cabecalhos: { authorization: `Bearer ${accessToken}` }, ...(buscar ? { buscar } : {}) },
  )
  if (!r.ok) return { erro: r.erro ?? '' }

  const c = r.corpo as { collection?: Array<{ status?: string; start_time?: string }> } | null
  return (c?.collection ?? [])
    .filter((h) => h.status === 'available' && h.start_time)
    .map((h) => new Date(h.start_time!))
}

/** Link de uso único para um tipo de evento.
 *
 *  Uso único de propósito: um link reutilizável circulando por aí deixa qualquer
 *  pessoa marcar na agenda do cliente. */
export async function linkDeAgendamento(
  accessToken: string,
  tipoDeEventoUri: string,
  buscar?: Buscar,
): Promise<{ url: string } | { erro: string }> {
  const r = await requisitar(`${API}/scheduling_links`, {
    cabecalhos: { authorization: `Bearer ${accessToken}` },
    corpo: { max_event_count: 1, owner: tipoDeEventoUri, owner_type: 'EventType' },
    ...(buscar ? { buscar } : {}),
  })
  if (!r.ok) return { erro: r.erro ?? '' }
  const c = r.corpo as { resource?: { booking_url?: string } } | null
  if (!c?.resource?.booking_url) return { erro: 'resposta sem booking_url' }
  return { url: c.resource.booking_url }
}

export async function assinarWebhook(
  accessToken: string,
  url: string,
  organizacao: string,
  usuario: string,
  buscar?: Buscar,
): Promise<{ id: string; chave?: string } | { erro: string }> {
  const r = await requisitar(`${API}/webhook_subscriptions`, {
    cabecalhos: { authorization: `Bearer ${accessToken}` },
    corpo: {
      url,
      events: ['invitee.created', 'invitee.canceled'],
      organization: organizacao,
      user: usuario,
      scope: 'user',
    },
    ...(buscar ? { buscar } : {}),
  })
  if (!r.ok) return { erro: r.erro ?? '' }
  const c = r.corpo as { resource?: { uri?: string; signing_key?: string } } | null
  return {
    id: c?.resource?.uri ?? '',
    ...(c?.resource?.signing_key ? { chave: c.resource.signing_key } : {}),
  }
}

/** Confere a assinatura do webhook.
 *
 *  O corpo precisa ser o texto **cru**: reserializar o JSON muda espaço e ordem
 *  de chave e a assinatura deixa de bater. A janela de tolerância existe porque
 *  um `t` antigo reaproveitado é um replay. */
export function conferirAssinaturaCalendly(
  cabecalho: string | null | undefined,
  corpoCru: string,
  chave: string,
  toleranciaSeg = 300,
): boolean {
  if (!cabecalho || !chave) return false

  const partes = Object.fromEntries(
    cabecalho.split(',').map((p) => {
      const i = p.indexOf('=')
      return [p.slice(0, i).trim(), p.slice(i + 1).trim()]
    }),
  ) as { t?: string; v1?: string }

  if (!partes.t || !partes.v1) return false
  const idade = Math.abs(Date.now() / 1000 - Number(partes.t))
  if (!Number.isFinite(idade) || idade > toleranciaSeg) return false

  const esperado = createHmac('sha256', chave).update(`${partes.t}.${corpoCru}`).digest('hex')
  const a = Buffer.from(partes.v1)
  const b = Buffer.from(esperado)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** Traduz o webhook para o domínio. */
export function interpretarWebhookCalendly(corpo: unknown): ReuniaoConfirmada | null {
  const e = corpo as {
    event?: string
    payload?: {
      uri?: string
      email?: string
      name?: string
      status?: string
      cancellation?: { reason?: string }
      scheduled_event?: { uri?: string; start_time?: string; end_time?: string }
    }
  } | null

  if (e?.event !== 'invitee.created' && e?.event !== 'invitee.canceled') return null
  const p = e.payload
  const inicio = p?.scheduled_event?.start_time
  if (!p?.email || !inicio) return null

  return {
    provedor: 'calendly',
    externoId: p.scheduled_event?.uri ?? p.uri ?? '',
    emailDoConvidado: p.email.toLowerCase(),
    ...(p.name ? { nomeDoConvidado: p.name } : {}),
    inicio: new Date(inicio),
    ...(p.scheduled_event?.end_time ? { fim: new Date(p.scheduled_event.end_time) } : {}),
    cancelada: e.event === 'invitee.canceled' || p.status === 'canceled',
    ...(p.cancellation?.reason ? { motivoCancelamento: p.cancellation.reason } : {}),
    payload: (corpo ?? {}) as Record<string, unknown>,
  }
}

export interface ContextoCalendly {
  accessToken: string
  tipoDeEventoUri: string
  buscar?: Buscar
}

/** Adaptador de agenda do Calendly: sempre link, nunca marcação direta. */
export function adaptadorCalendly(ctx: ContextoCalendly): AdaptadorAgenda {
  return {
    provedor: 'calendly',
    marcaDireto: false,

    async oferecer(_pedido: PedidoReuniao): Promise<ResultadoReuniao> {
      const r = await linkDeAgendamento(ctx.accessToken, ctx.tipoDeEventoUri, ctx.buscar)
      if ('erro' in r) return { tipo: 'falhou', erro: r.erro }
      return { tipo: 'link', url: r.url }
    },
  }
}

export function configCalendlyDoAmbiente(
  env: Record<string, string | undefined> = process.env,
): ConfigCalendly | null {
  if (!env.CALENDLY_CLIENT_ID || !env.CALENDLY_CLIENT_SECRET) return null
  return {
    clientId: env.CALENDLY_CLIENT_ID,
    clientSecret: env.CALENDLY_CLIENT_SECRET,
    redirectUri:
      env.CALENDLY_REDIRECT_URI ?? 'https://app.avexa.global/api/integracoes/calendly/retorno',
  }
}
