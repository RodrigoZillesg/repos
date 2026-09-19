import type { Buscar } from './http.ts'
import { requisitar } from './http.ts'

/** HubSpot CRM (API v3), por OAuth.
 *
 *  Cada cliente conecta o próprio portal. Não usamos token de private app: ele
 *  é um segredo de longa duração que alguém teria de copiar e colar no painel,
 *  e um segredo colado é um segredo que circula por e-mail.
 *
 *  Duas decisões que não são detalhe:
 *
 *  1. Entregar lead é **upsert**, nunca "criar contato". O mesmo lead volta por
 *     reenvio, por segunda campanha, por formulário preenchido de novo — e três
 *     contatos duplicados no CRM do cliente é pior do que não entregar.
 *  2. Nada de inventar valor de `hs_lead_status`. Esse campo é customizado em
 *     praticamente todo portal; as opções válidas são lidas na conexão e o
 *     operador escolhe qual significa "qualificado". Mandar um valor que o
 *     portal não tem devolve 400 e derruba a entrega inteira.
 *
 *  Os formatos seguem a API v3 documentada. Vale um teste de fumaça contra um
 *  portal real antes de ligar para cliente. */

const API = 'https://api.hubapi.com'
const AUTORIZAR = 'https://app.hubspot.com/oauth/authorize'

/** Contatos para ler e escrever, esquema de contato para criar as propriedades
 *  da Avexa, e notas para registrar o resumo da conversa. Nada além disso: um
 *  escopo amplo num CRM é acesso a toda a base comercial do cliente. */
export const ESCOPOS_HUBSPOT = [
  'oauth',
  'crm.objects.contacts.read',
  'crm.objects.contacts.write',
  'crm.schemas.contacts.read',
  'crm.schemas.contacts.write',
  // Engajamentos: a nota com o resumo da conversa e a reunião marcada. O app
  // precisa ter esses escopos habilitados no HubSpot, e um portal que não os
  // concedeu devolve 403 — que aqui degrada o engajamento, nunca o contato.
  'crm.objects.meetings.read',
  'crm.objects.meetings.write',
]

export interface ConfigHubspot {
  clientId: string
  clientSecret: string
  redirectUri: string
  buscar?: Buscar
}

export interface CredenciaisHubspot {
  accessToken: string
  refreshToken?: string
  expiraEm: Date
}

export function urlDeConsentimentoHubspot(cfg: ConfigHubspot, state: string): string {
  const p = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    scope: ESCOPOS_HUBSPOT.join(' '),
    state,
  })
  return `${AUTORIZAR}?${p.toString()}`
}

function lerToken(corpo: unknown, anterior?: string): CredenciaisHubspot | { erro: string } {
  const r = corpo as {
    access_token?: string
    refresh_token?: string
    expires_in?: number
    message?: string
    error?: string
  } | null

  if (!r?.access_token) return { erro: r?.message ?? r?.error ?? 'resposta sem access_token' }
  return {
    accessToken: r.access_token,
    ...(r.refresh_token ? { refreshToken: r.refresh_token } : anterior ? { refreshToken: anterior } : {}),
    // O access token do HubSpot dura 30 minutos. Um minuto de folga evita
    // usar um token que expira no meio da chamada.
    expiraEm: new Date(Date.now() + ((r.expires_in ?? 1800) - 60) * 1000),
  }
}

export async function trocarCodigoHubspot(
  cfg: ConfigHubspot,
  codigo: string,
): Promise<CredenciaisHubspot | { erro: string }> {
  const r = await requisitar(`${API}/oauth/v1/token`, {
    formulario: true,
    corpo: {
      grant_type: 'authorization_code',
      code: codigo,
      redirect_uri: cfg.redirectUri,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
    },
    ...(cfg.buscar ? { buscar: cfg.buscar } : {}),
  })
  if (!r.ok) return { erro: (r.corpo as { message?: string } | null)?.message ?? r.erro ?? '' }
  return lerToken(r.corpo)
}

export async function renovarHubspot(
  cfg: ConfigHubspot,
  refreshToken: string,
): Promise<CredenciaisHubspot | { erro: string; revogado?: boolean }> {
  const r = await requisitar(`${API}/oauth/v1/token`, {
    formulario: true,
    corpo: {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
    },
    ...(cfg.buscar ? { buscar: cfg.buscar } : {}),
  })
  if (!r.ok) {
    const e = r.corpo as { message?: string; status?: string } | null
    // O HubSpot devolve 400 com BAD_REFRESH_TOKEN quando o cliente desinstala o
    // app. Insistir nisso nunca funciona.
    const msg = e?.message ?? r.erro ?? ''
    const revogado = r.status === 400 || r.status === 401
    return { erro: msg, ...(revogado ? { revogado: true } : {}) }
  }
  return lerToken(r.corpo, refreshToken)
}

export interface InfoTokenHubspot {
  hubId: number
  dominio?: string
  usuario?: string
  escopos: string[]
}

/** Quem é o portal do outro lado. Serve para o painel dizer em qual conta o
 *  lead vai cair — "conectado" sem dizer onde é como não dizer nada. */
export async function infoDoTokenHubspot(
  accessToken: string,
  buscar?: Buscar,
): Promise<InfoTokenHubspot | { erro: string }> {
  const r = await requisitar(`${API}/oauth/v1/access-tokens/${encodeURIComponent(accessToken)}`, {
    metodo: 'GET',
    ...(buscar ? { buscar } : {}),
  })
  if (!r.ok) return { erro: r.erro ?? '' }
  const c = r.corpo as {
    hub_id?: number
    hub_domain?: string
    user?: string
    scopes?: string[]
  } | null
  if (!c?.hub_id) return { erro: 'resposta sem hub_id' }
  return {
    hubId: c.hub_id,
    ...(c.hub_domain ? { dominio: c.hub_domain } : {}),
    ...(c.user ? { usuario: c.user } : {}),
    escopos: c.scopes ?? [],
  }
}

/** Opções válidas de `hs_lead_status` **neste** portal. */
export async function statusDeLead(
  accessToken: string,
  buscar?: Buscar,
): Promise<Array<{ valor: string; rotulo: string }> | { erro: string }> {
  const r = await requisitar(`${API}/crm/v3/properties/contacts/hs_lead_status`, {
    metodo: 'GET',
    cabecalhos: { authorization: `Bearer ${accessToken}` },
    ...(buscar ? { buscar } : {}),
  })
  if (!r.ok) return { erro: r.erro ?? '' }
  const c = r.corpo as { options?: Array<{ value?: string; label?: string; hidden?: boolean }> } | null
  return (c?.options ?? [])
    .filter((o) => o.value && !o.hidden)
    .map((o) => ({ valor: o.value!, rotulo: o.label ?? o.value! }))
}

/** As propriedades que a Avexa escreve, e que o portal do cliente não tem.
 *  Criadas na conexão, não na primeira entrega: descobrir que falta propriedade
 *  no meio de um lead quente é tarde demais. */
const PROPRIEDADES = [
  { name: 'avexa_score', label: 'Avexa · score', type: 'number', fieldType: 'number' },
  { name: 'avexa_resumo', label: 'Avexa · resumo da conversa', type: 'string', fieldType: 'textarea' },
  { name: 'avexa_etiquetas', label: 'Avexa · etiquetas', type: 'string', fieldType: 'text' },
  { name: 'avexa_origem', label: 'Avexa · origem', type: 'string', fieldType: 'text' },
] as const

export async function garantirPropriedades(
  accessToken: string,
  buscar?: Buscar,
): Promise<{ criadas: string[] } | { erro: string }> {
  const cab = { authorization: `Bearer ${accessToken}` }
  const criadas: string[] = []

  // O grupo pode já existir de uma conexão anterior; 409 aqui é sucesso.
  const grupo = await requisitar(`${API}/crm/v3/properties/contacts/groups`, {
    cabecalhos: cab,
    corpo: { name: 'avexa', label: 'Avexa' },
    ...(buscar ? { buscar } : {}),
  })
  if (!grupo.ok && grupo.status !== 409) return { erro: grupo.erro ?? '' }

  for (const p of PROPRIEDADES) {
    const existe = await requisitar(`${API}/crm/v3/properties/contacts/${p.name}`, {
      metodo: 'GET',
      cabecalhos: cab,
      ...(buscar ? { buscar } : {}),
    })
    if (existe.ok) continue

    const r = await requisitar(`${API}/crm/v3/properties/contacts`, {
      cabecalhos: cab,
      corpo: { ...p, groupName: 'avexa' },
      ...(buscar ? { buscar } : {}),
    })
    if (!r.ok && r.status !== 409) return { erro: `${p.name}: ${r.erro ?? ''}` }
    criadas.push(p.name)
  }

  return { criadas }
}

export interface ContatoHubspot {
  email?: string | null
  telefone?: string | null
  nome?: string | null
  sobrenome?: string | null
  score?: number | null
  resumo?: string | null
  etiquetas?: string[]
  origem?: string | null
  /** Valor de `hs_lead_status` escolhido pelo operador para este caso. */
  statusLead?: string | null
}

export type ResultadoContato =
  | { ok: true; id: string; criado: boolean }
  | { ok: false; erro: string; reenviavel: boolean }

function propriedades(c: ContatoHubspot): Record<string, string> {
  const p: Record<string, string> = {}
  if (c.email) p.email = c.email
  if (c.telefone) p.phone = c.telefone
  if (c.nome) p.firstname = c.nome
  if (c.sobrenome) p.lastname = c.sobrenome
  if (c.score !== null && c.score !== undefined) p.avexa_score = String(c.score)
  if (c.resumo) p.avexa_resumo = c.resumo
  if (c.etiquetas?.length) p.avexa_etiquetas = c.etiquetas.join(', ')
  if (c.origem) p.avexa_origem = c.origem
  if (c.statusLead) p.hs_lead_status = c.statusLead
  return p
}

/** Acha o contato pelo telefone quando não há e-mail.
 *  `email` é único no HubSpot e dá upsert direto; telefone não é, então aqui
 *  não há atalho: é busca mesmo. */
async function acharPorTelefone(
  accessToken: string,
  telefone: string,
  buscar?: Buscar,
): Promise<string | null> {
  const r = await requisitar(`${API}/crm/v3/objects/contacts/search`, {
    cabecalhos: { authorization: `Bearer ${accessToken}` },
    corpo: {
      filterGroups: [{ filters: [{ propertyName: 'phone', operator: 'EQ', value: telefone }] }],
      properties: ['email'],
      limit: 1,
    },
    ...(buscar ? { buscar } : {}),
  })
  if (!r.ok) return null
  const c = r.corpo as { results?: Array<{ id?: string }> } | null
  return c?.results?.[0]?.id ?? null
}

/** Cria ou atualiza o contato. Nunca duplica. */
export async function salvarContato(
  accessToken: string,
  c: ContatoHubspot,
  buscar?: Buscar,
): Promise<ResultadoContato> {
  const cab = { authorization: `Bearer ${accessToken}` }
  const corpo = { properties: propriedades(c) }
  if (Object.keys(corpo.properties).length === 0) {
    return { ok: false, erro: 'lead sem nenhum dado para gravar', reenviavel: false }
  }

  if (c.email) {
    // `idProperty=email` é o upsert por propriedade única do HubSpot.
    const patch = await requisitar(
      `${API}/crm/v3/objects/contacts/${encodeURIComponent(c.email)}?idProperty=email`,
      { metodo: 'PATCH', cabecalhos: cab, corpo, ...(buscar ? { buscar } : {}) },
    )
    if (patch.ok) {
      const r = patch.corpo as { id?: string } | null
      return { ok: true, id: r?.id ?? '', criado: false }
    }
    if (patch.status !== 404) {
      return { ok: false, erro: patch.erro ?? '', reenviavel: patch.reenviavel }
    }
  } else if (c.telefone) {
    const id = await acharPorTelefone(accessToken, c.telefone, buscar)
    if (id) {
      const patch = await requisitar(`${API}/crm/v3/objects/contacts/${id}`, {
        metodo: 'PATCH',
        cabecalhos: cab,
        corpo,
        ...(buscar ? { buscar } : {}),
      })
      if (patch.ok) return { ok: true, id, criado: false }
      return { ok: false, erro: patch.erro ?? '', reenviavel: patch.reenviavel }
    }
  }

  const criar = await requisitar(`${API}/crm/v3/objects/contacts`, {
    cabecalhos: cab,
    corpo,
    ...(buscar ? { buscar } : {}),
  })
  if (criar.ok) {
    const r = criar.corpo as { id?: string } | null
    return { ok: true, id: r?.id ?? '', criado: true }
  }

  // 409: outra coisa criou o contato entre a busca e a criação, ou o portal
  // casou por outra regra. O contato existe — atualizar é o certo.
  if (criar.status === 409 && c.email) {
    const patch = await requisitar(
      `${API}/crm/v3/objects/contacts/${encodeURIComponent(c.email)}?idProperty=email`,
      { metodo: 'PATCH', cabecalhos: cab, corpo, ...(buscar ? { buscar } : {}) },
    )
    if (patch.ok) {
      const r = patch.corpo as { id?: string } | null
      return { ok: true, id: r?.id ?? '', criado: false }
    }
  }

  return { ok: false, erro: criar.erro ?? '', reenviavel: criar.reenviavel }
}

/** Nota na linha do tempo do contato: é onde o time comercial lê o que a Avexa
 *  conversou antes de ligar. Associação 202 é a de nota para contato. */
export async function criarNota(
  accessToken: string,
  contatoId: string,
  texto: string,
  quando: Date = new Date(),
  buscar?: Buscar,
): Promise<{ ok: true; id: string } | { ok: false; erro: string; semPermissao: boolean }> {
  const r = await requisitar(`${API}/crm/v3/objects/notes`, {
    cabecalhos: { authorization: `Bearer ${accessToken}` },
    corpo: {
      properties: { hs_note_body: texto, hs_timestamp: quando.toISOString() },
      associations: [
        {
          to: { id: contatoId },
          types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 202 }],
        },
      ],
    },
    ...(buscar ? { buscar } : {}),
  })
  if (r.ok) return { ok: true, id: (r.corpo as { id?: string } | null)?.id ?? '' }
  // O escopo de notas nem sempre está concedido, e isso não pode derrubar a
  // entrega: o contato, que é o que importa, já foi gravado.
  return { ok: false, erro: r.erro ?? '', semPermissao: r.status === 403 }
}

/** Reunião na linha do tempo do contato.
 *
 *  Nota com a data escrita dentro não é reunião: não entra na agenda de
 *  ninguém, não aparece nas atividades do dia do vendedor e não muda de estado
 *  quando o lead cancela. Um objeto `meeting` faz as três coisas.
 *
 *  A reunião é criada uma vez e **atualizada** depois. O id do objeto fica
 *  guardado do nosso lado justamente para isso: lead reentregue ou reunião
 *  remarcada não pode virar duas reuniões na linha do tempo. */

export type DesfechoReuniao = 'SCHEDULED' | 'COMPLETED' | 'RESCHEDULED' | 'NO_SHOW' | 'CANCELED'

export interface ReuniaoHubspot {
  titulo: string
  corpo?: string | undefined
  inicio: Date
  fim?: Date | undefined
  /** Link do evento ou da sala, para o vendedor entrar de dentro do CRM. */
  link?: string | undefined
  desfecho: DesfechoReuniao
}

export type ResultadoReuniaoHubspot =
  | { ok: true; id: string; criada: boolean }
  | { ok: false; erro: string; semPermissao: boolean; reenviavel: boolean }

/** Associação 200 é a de reunião para contato, como 202 é a de nota. */
export async function salvarReuniaoHubspot(
  accessToken: string,
  contatoId: string,
  r: ReuniaoHubspot,
  reuniaoId?: string | undefined,
  buscar?: Buscar,
): Promise<ResultadoReuniaoHubspot> {
  const fim = r.fim ?? new Date(r.inicio.getTime() + 30 * 60_000)
  const propriedades: Record<string, string> = {
    hs_timestamp: r.inicio.toISOString(),
    hs_meeting_title: r.titulo,
    hs_meeting_start_time: r.inicio.toISOString(),
    hs_meeting_end_time: fim.toISOString(),
    hs_meeting_outcome: r.desfecho,
    ...(r.corpo ? { hs_meeting_body: r.corpo } : {}),
    ...(r.link ? { hs_meeting_external_url: r.link } : {}),
  }

  const cab = { authorization: `Bearer ${accessToken}` }

  if (reuniaoId) {
    const patch = await requisitar(`${API}/crm/v3/objects/meetings/${reuniaoId}`, {
      metodo: 'PATCH',
      cabecalhos: cab,
      corpo: { properties: propriedades },
      ...(buscar ? { buscar } : {}),
    })
    if (patch.ok) return { ok: true, id: reuniaoId, criada: false }
    // 404: alguém apagou a reunião no portal. Criar de novo é o certo — o
    // compromisso existe, e o vendedor precisa vê-lo.
    if (patch.status !== 404) {
      return {
        ok: false,
        erro: patch.erro ?? '',
        semPermissao: patch.status === 403,
        reenviavel: patch.reenviavel,
      }
    }
  }

  const criar = await requisitar(`${API}/crm/v3/objects/meetings`, {
    cabecalhos: cab,
    corpo: {
      properties: propriedades,
      associations: [
        {
          to: { id: contatoId },
          types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 200 }],
        },
      ],
    },
    ...(buscar ? { buscar } : {}),
  })
  if (criar.ok) return { ok: true, id: (criar.corpo as { id?: string } | null)?.id ?? '', criada: true }
  return {
    ok: false,
    erro: criar.erro ?? '',
    semPermissao: criar.status === 403,
    reenviavel: criar.reenviavel,
  }
}

export function configHubspotDoAmbiente(
  env: Record<string, string | undefined> = process.env,
): ConfigHubspot | null {
  if (!env.HUBSPOT_CLIENT_ID || !env.HUBSPOT_CLIENT_SECRET) return null
  return {
    clientId: env.HUBSPOT_CLIENT_ID,
    clientSecret: env.HUBSPOT_CLIENT_SECRET,
    redirectUri: env.HUBSPOT_REDIRECT_URI ?? 'https://app.avexa.global/api/integracoes/hubspot/retorno',
  }
}
