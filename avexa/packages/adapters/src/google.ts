import {
  escolherConsultor,
  horariosLivres,
  type AdaptadorAgenda,
  type Intervalo,
  type LimitesMotor,
  type PedidoReuniao,
  type ResultadoReuniao,
} from '@avexa/core'
import { requisitar, type Buscar } from './http.ts'

/** Google Workspace: OAuth, Calendar e Sheets.
 *
 *  Cada cliente conecta a própria conta — a Avexa não é dona da agenda de
 *  ninguém. O que guardamos é o refresh token, cifrado; o access token vive
 *  minutos e é renovado na hora do uso. */

export interface ConfigGoogle {
  clientId: string
  clientSecret: string
  redirectUri: string
  buscar?: Buscar
}

/** Escopos mínimos por integração. Pedir mais do que se usa é pedir para o
 *  cliente recusar a tela de consentimento. */
export const ESCOPOS = {
  google_calendar: [
    'https://www.googleapis.com/auth/calendar.events',
    'https://www.googleapis.com/auth/calendar.readonly',
  ],
  google_sheets: ['https://www.googleapis.com/auth/spreadsheets'],
} as const

export function urlDeConsentimento(
  cfg: ConfigGoogle,
  escopos: readonly string[],
  state: string,
): string {
  const p = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: 'code',
    scope: escopos.join(' '),
    // `offline` + `consent` juntos: sem os dois o Google devolve refresh token
    // só na primeira autorização da conta, e uma reconexão viria sem ele — o
    // cliente pareceria conectado e pararia de funcionar em uma hora.
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  })
  return `https://accounts.google.com/o/oauth2/v2/auth?${p.toString()}`
}

export interface Credenciais {
  accessToken: string
  refreshToken?: string
  expiraEm: Date
  escopos: string[]
}

interface RespostaToken {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  scope?: string
  error?: string
  error_description?: string
}

function lerToken(corpo: unknown, anterior?: string): Credenciais | { erro: string } {
  const r = corpo as RespostaToken | null
  if (!r?.access_token) {
    return { erro: r?.error_description ?? r?.error ?? 'resposta sem access_token' }
  }
  return {
    accessToken: r.access_token,
    ...(r.refresh_token ? { refreshToken: r.refresh_token } : anterior ? { refreshToken: anterior } : {}),
    // Um minuto de folga: renovar em cima da expiração perde a corrida quando a
    // chamada seguinte demora.
    expiraEm: new Date(Date.now() + ((r.expires_in ?? 3600) - 60) * 1000),
    escopos: (r.scope ?? '').split(' ').filter(Boolean),
  }
}

export async function trocarCodigo(
  cfg: ConfigGoogle,
  codigo: string,
): Promise<Credenciais | { erro: string }> {
  const r = await requisitar('https://oauth2.googleapis.com/token', {
    corpo: {
      code: codigo,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      redirect_uri: cfg.redirectUri,
      grant_type: 'authorization_code',
    },
    formulario: true,
    ...(cfg.buscar ? { buscar: cfg.buscar } : {}),
  })
  if (!r.ok) return { erro: (r.corpo as RespostaToken | null)?.error_description ?? r.erro ?? '' }
  return lerToken(r.corpo)
}

export async function renovarAcesso(
  cfg: ConfigGoogle,
  refreshToken: string,
): Promise<Credenciais | { erro: string; revogado?: boolean }> {
  const r = await requisitar('https://oauth2.googleapis.com/token', {
    corpo: {
      refresh_token: refreshToken,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      grant_type: 'refresh_token',
    },
    formulario: true,
    ...(cfg.buscar ? { buscar: cfg.buscar } : {}),
  })

  if (!r.ok) {
    const e = r.corpo as RespostaToken | null
    // `invalid_grant` quer dizer que o cliente revogou o acesso ou trocou a
    // senha. Renovar de novo nunca vai funcionar: alguém precisa reconectar.
    const revogado = e?.error === 'invalid_grant'
    return { erro: e?.error_description ?? e?.error ?? r.erro ?? '', ...(revogado ? { revogado } : {}) }
  }
  return lerToken(r.corpo, refreshToken)
}

/** Revoga o acesso no Google ao desconectar. Sem isso, o consentimento continua
 *  ativo na conta do cliente mesmo depois de ele desligar a integração aqui. */
export async function revogar(cfg: ConfigGoogle, token: string): Promise<boolean> {
  const r = await requisitar('https://oauth2.googleapis.com/revoke', {
    corpo: { token },
    formulario: true,
    ...(cfg.buscar ? { buscar: cfg.buscar } : {}),
  })
  return r.ok
}

/* ------------------------------- Calendar -------------------------------- */

export interface AgendaDoGoogle {
  id: string
  nome: string
  /** A agenda pessoal da conta conectada. Costuma ser a que o operador quer. */
  principal: boolean
  /** `owner`, `writer`, `reader` ou `freeBusyReader`, como o Google devolve.
   *  Guardado cru porque quem decide o que fazer com cada nível é a tela. */
  acesso: string
  fuso: string | null
}

/** Pode receber um evento criado por nós, ou só ser consultada?
 *
 *  A diferença não aparece ao olhar a lista, e escolher uma agenda só de
 *  leitura daria um cliente "configurado" que falha na primeira marcação. */
export const podeAgendar = (acesso: string) => acesso === 'owner' || acesso === 'writer'

/** As agendas que a conta conectada enxerga.
 *
 *  Devolve tudo, inclusive o que não dá para agendar: esconder as agendas só de
 *  leitura faria o operador procurar uma agenda que ele vê no Google e não
 *  acha aqui. Quem mostra é que explica o porquê. */
export async function listarAgendas(
  accessToken: string,
  buscar?: Buscar,
): Promise<AgendaDoGoogle[] | { erro: string }> {
  const agendas: AgendaDoGoogle[] = []
  let pagina: string | undefined

  // Conta de agência costuma ter muita agenda compartilhada; sem paginar, o
  // time do cliente apareceria pela metade e ninguém desconfiaria.
  for (let i = 0; i < 10; i++) {
    const q = new URLSearchParams({ maxResults: '250', showHidden: 'true' })
    if (pagina) q.set('pageToken', pagina)

    const r = await requisitar(
      `https://www.googleapis.com/calendar/v3/users/me/calendarList?${q.toString()}`,
      { metodo: 'GET', cabecalhos: { authorization: `Bearer ${accessToken}` }, ...(buscar ? { buscar } : {}) },
    )
    if (!r.ok) return { erro: r.erro ?? '' }

    const c = r.corpo as {
      items?: Array<{
        id?: string
        summary?: string
        summaryOverride?: string
        primary?: boolean
        accessRole?: string
        timeZone?: string
        deleted?: boolean
      }>
      nextPageToken?: string
    } | null

    for (const item of c?.items ?? []) {
      if (!item.id || item.deleted) continue
      agendas.push({
        id: item.id,
        // `summaryOverride` é o apelido que o dono da conta deu. Ele vence,
        // porque é o nome pelo qual essa pessoa conhece a agenda.
        nome: item.summaryOverride ?? item.summary ?? item.id,
        principal: item.primary === true,
        acesso: item.accessRole ?? 'reader',
        fuso: item.timeZone ?? null,
      })
    }

    pagina = c?.nextPageToken
    if (!pagina) break
  }

  // A principal primeiro, depois quem dá para agendar, depois por nome: é a
  // ordem em que o operador procura.
  return agendas.sort(
    (a, b) =>
      Number(b.principal) - Number(a.principal) ||
      Number(podeAgendar(b.acesso)) - Number(podeAgendar(a.acesso)) ||
      a.nome.localeCompare(b.nome),
  )
}

/** Resultado etiquetado de propósito: um `Record` com assinatura de índice não
 *  se distingue de `{ erro }` por `'erro' in x`, e a checagem passaria em
 *  silêncio pelo caminho errado. */
export type RespostaOcupados =
  | { ok: true; calendarios: Record<string, Intervalo[]> }
  | { ok: false; erro: string }

export async function ocupados(
  accessToken: string,
  calendarios: readonly string[],
  de: Date,
  ate: Date,
  buscar?: Buscar,
): Promise<RespostaOcupados> {
  const r = await requisitar('https://www.googleapis.com/calendar/v3/freeBusy', {
    cabecalhos: { authorization: `Bearer ${accessToken}` },
    corpo: {
      timeMin: de.toISOString(),
      timeMax: ate.toISOString(),
      items: calendarios.map((id) => ({ id })),
    },
    ...(buscar ? { buscar } : {}),
  })
  if (!r.ok) return { ok: false, erro: r.erro ?? '' }

  const c = r.corpo as {
    calendars?: Record<string, { busy?: Array<{ start: string; end: string }>; errors?: unknown[] }>
  } | null

  const saida: Record<string, Intervalo[]> = {}
  for (const id of calendarios) {
    const entrada = c?.calendars?.[id]
    // Calendário que o cliente não compartilhou volta com `errors`. Tratar isso
    // como "vazio" marcaria reunião em cima de compromisso existente, então ele
    // fica de fora do rodízio em vez de entrar como livre.
    if (!entrada || (entrada.errors && entrada.errors.length > 0)) continue
    saida[id] = (entrada.busy ?? []).map((b) => ({ inicio: new Date(b.start), fim: new Date(b.end) }))
  }
  return { ok: true, calendarios: saida }
}

export interface PedidoEvento {
  calendarId: string
  titulo: string
  descricao?: string
  inicio: Date
  fim: Date
  fuso: string
  convidados: readonly string[]
  /** Minutos antes para o lembrete; ausente não envia. */
  lembreteMin?: number
  /** Cria um link do Meet junto. */
  comMeet?: boolean
}

export async function criarEvento(
  accessToken: string,
  p: PedidoEvento,
  buscar?: Buscar,
): Promise<{ id: string; link?: string; meet?: string } | { erro: string }> {
  const query = new URLSearchParams({ sendUpdates: 'all' })
  if (p.comMeet) query.set('conferenceDataVersion', '1')

  const r = await requisitar(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(p.calendarId)}/events?${query}`,
    {
      cabecalhos: { authorization: `Bearer ${accessToken}` },
      corpo: {
        summary: p.titulo,
        ...(p.descricao ? { description: p.descricao } : {}),
        start: { dateTime: p.inicio.toISOString(), timeZone: p.fuso },
        end: { dateTime: p.fim.toISOString(), timeZone: p.fuso },
        attendees: p.convidados.map((email) => ({ email })),
        reminders:
          p.lembreteMin === undefined
            ? { useDefault: true }
            : { useDefault: false, overrides: [{ method: 'email', minutes: p.lembreteMin }] },
        ...(p.comMeet
          ? {
              conferenceData: {
                createRequest: {
                  requestId: `avexa-${Date.now()}`,
                  conferenceSolutionKey: { type: 'hangoutsMeet' },
                },
              },
            }
          : {}),
      },
      ...(buscar ? { buscar } : {}),
    },
  )

  if (!r.ok) return { erro: r.erro ?? '' }
  const e = r.corpo as {
    id?: string
    htmlLink?: string
    hangoutLink?: string
  } | null
  return {
    id: e?.id ?? '',
    ...(e?.htmlLink ? { link: e.htmlLink } : {}),
    ...(e?.hangoutLink ? { meet: e.hangoutLink } : {}),
  }
}

/* -------------------------------- Sheets --------------------------------- */

export async function acrescentarLinha(
  accessToken: string,
  planilhaId: string,
  aba: string,
  valores: readonly (string | number | null)[],
  buscar?: Buscar,
): Promise<{ ok: true; linha?: string } | { erro: string }> {
  const faixa = `${aba}!A:A`
  const r = await requisitar(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(planilhaId)}/values/${encodeURIComponent(faixa)}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    {
      cabecalhos: { authorization: `Bearer ${accessToken}` },
      corpo: { values: [valores.map((v) => (v === null ? '' : v))] },
      ...(buscar ? { buscar } : {}),
    },
  )
  if (!r.ok) return { erro: r.erro ?? '' }
  const c = r.corpo as { updates?: { updatedRange?: string } } | null
  return { ok: true, ...(c?.updates?.updatedRange ? { linha: c.updates.updatedRange } : {}) }
}

/** Garante que a aba tem cabeçalho, na primeira escrita. */
export async function garantirCabecalho(
  accessToken: string,
  planilhaId: string,
  aba: string,
  cabecalho: readonly string[],
  buscar?: Buscar,
): Promise<boolean> {
  const r = await requisitar(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(planilhaId)}/values/${encodeURIComponent(`${aba}!1:1`)}`,
    { metodo: 'GET', cabecalhos: { authorization: `Bearer ${accessToken}` }, ...(buscar ? { buscar } : {}) },
  )
  if (!r.ok) return false
  const c = r.corpo as { values?: string[][] } | null
  if (c?.values?.[0]?.length) return true

  const w = await requisitar(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(planilhaId)}/values/${encodeURIComponent(`${aba}!A1`)}?valueInputOption=RAW`,
    {
      metodo: 'PUT',
      cabecalhos: { authorization: `Bearer ${accessToken}` },
      corpo: { values: [cabecalho] },
      ...(buscar ? { buscar } : {}),
    },
  )
  return w.ok
}

export function configGoogleDoAmbiente(
  env: Record<string, string | undefined> = process.env,
): ConfigGoogle | null {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return null
  return {
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    redirectUri:
      env.GOOGLE_REDIRECT_URI ?? 'https://app.avexa.global/api/integracoes/google/retorno',
  }
}

/* --------------------------- Adaptador de agenda --------------------------- */

export interface ContextoAgendaGoogle {
  accessToken: string
  /** Agendas do time, na ordem do rodízio. */
  calendarios: readonly string[]
  rodizio: boolean
  limites: LimitesMotor
  buscar?: Buscar
}

/** Google Calendar atrás da interface de agenda.
 *
 *  Marca direto porque temos escrita na agenda do time: escolhemos o horário,
 *  criamos o compromisso e convidamos o lead. */
export function adaptadorGoogleAgenda(ctx: ContextoAgendaGoogle): AdaptadorAgenda {
  return {
    provedor: 'google_calendar',
    marcaDireto: true,

    async ocupados(de, ate) {
      const r = await ocupados(ctx.accessToken, ctx.calendarios, de, ate, ctx.buscar)
      return r.ok ? r.calendarios : null
    },

    async oferecer(p: PedidoReuniao): Promise<ResultadoReuniao> {
      if (ctx.calendarios.length === 0) {
        return { tipo: 'falhou', erro: 'nenhuma agenda escolhida para este cliente' }
      }

      // Duas semanas de horizonte: oferecer daqui a um mês não ajuda ninguém.
      const ate = new Date(p.de.getTime() + 14 * 86_400_000)
      const resposta = await ocupados(ctx.accessToken, ctx.calendarios, p.de, ate, ctx.buscar)
      if (!resposta.ok) return { tipo: 'falhou', erro: resposta.erro }

      const livres = resposta.calendarios
      const disponiveis = Object.keys(livres)
      if (disponiveis.length === 0) {
        return { tipo: 'falhou', erro: 'nenhuma das agendas configuradas está acessível' }
      }

      // Sem rodízio, um horário só serve se a agenda única estiver livre. Com
      // rodízio, a varredura ignora os ocupados e a colisão é conferida por
      // consultor — senão um horário em que só um dos três está ocupado seria
      // descartado para todos.
      const horarios = horariosLivres({
        de: p.de,
        ate,
        duracaoMin: p.duracaoMin,
        ocupados: ctx.rodizio ? [] : Object.values(livres).flat(),
        fuso: p.fusoDoLead,
        limites: ctx.limites,
        quantos: 10,
        folgaMin: 10,
      })

      for (const inicio of horarios) {
        const fim = new Date(inicio.getTime() + p.duracaoMin * 60_000)
        const responsavel = ctx.rodizio
          ? escolherConsultor(disponiveis, livres, inicio, fim)
          : (disponiveis[0] ?? null)
        if (!responsavel) continue

        const evento = await criarEvento(
          ctx.accessToken,
          {
            calendarId: responsavel,
            titulo: p.titulo,
            ...(p.descricao ? { descricao: p.descricao } : {}),
            inicio,
            fim,
            fuso: p.fusoDoLead,
            convidados: [p.emailDoLead],
            ...(p.lembreteMin !== undefined ? { lembreteMin: p.lembreteMin } : {}),
            comMeet: true,
          },
          ctx.buscar,
        )
        if ('erro' in evento) return { tipo: 'falhou', erro: evento.erro }

        return {
          tipo: 'marcado',
          inicio,
          fim,
          responsavel,
          ...(evento.link ? { link: evento.link } : {}),
          ...(evento.meet ? { conferencia: evento.meet } : {}),
        }
      }

      return { tipo: 'falhou', erro: 'nenhum horário livre nas próximas duas semanas' }
    },
  }
}
