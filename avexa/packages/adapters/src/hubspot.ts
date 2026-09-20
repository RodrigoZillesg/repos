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

/** O que a Avexa pede no consentimento do cliente.
 *
 *  Cada linha aqui é acesso à base comercial de outra empresa, então a lista
 *  cresce por decisão, não por conveniência. */
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
  // Negócios e o esquema deles. O esquema é o que permite LER os pipelines do
  // portal e CRIAR um novo — sem ele, escolher pipeline seria digitar um id
  // interno de cabeça, e criar um seria mandar o cliente sair da Avexa.
  //
  // É o escopo mais pesado que pedimos: aparece na tela de consentimento como
  // permissão estrutural sobre o CRM, para todo cliente, mesmo os que nunca
  // vão criar pipeline. Foi uma decisão consciente — pedir menos agora
  // significaria um reconsentimento de todos os clientes no dia em que o
  // primeiro precisar.
  'crm.objects.deals.read',
  'crm.objects.deals.write',
  'crm.schemas.deals.read',
  'crm.schemas.deals.write',
]

/** Escopos que chegaram depois das primeiras conexões.
 *
 *  Um portal conectado antes disso tem token válido e sem eles: a chamada
 *  devolve 403 e, sem esta checagem, a tela ofereceria escolher pipeline e o
 *  operador levaria um erro sem entender que falta reconectar. */
export const ESCOPOS_NEGOCIOS = [
  'crm.objects.deals.read',
  'crm.objects.deals.write',
  'crm.schemas.deals.read',
  'crm.schemas.deals.write',
] as const

export const temEscoposDeNegocios = (concedidos: readonly string[] | undefined): boolean =>
  ESCOPOS_NEGOCIOS.every((e) => concedidos?.includes(e) ?? false)

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

/* ------------------------- Pipelines e negócios --------------------------- */

export interface EstagioHubspot {
  id: string
  rotulo: string
  /** Estágio de fechamento (ganho ou perdido). Mandar um lead novo direto para
   *  um deles é fechar negócio que nunca foi aberto. */
  fechado: boolean
  ordem: number
}

export interface PipelineHubspot {
  id: string
  rotulo: string
  ordem: number
  estagios: EstagioHubspot[]
}

function lerPipeline(p: {
  id?: string
  label?: string
  displayOrder?: number
  stages?: Array<{
    id?: string
    label?: string
    displayOrder?: number
    metadata?: { isClosed?: string | boolean }
  }>
}): PipelineHubspot | null {
  if (!p.id) return null
  return {
    id: p.id,
    rotulo: p.label ?? p.id,
    ordem: p.displayOrder ?? 0,
    estagios: (p.stages ?? [])
      .filter((e) => e.id)
      .map((e) => ({
        id: e.id!,
        rotulo: e.label ?? e.id!,
        // O HubSpot manda `isClosed` como a string "true"/"false" em boa parte
        // das respostas. Comparar com `true` daria sempre falso, e o estágio
        // de fechado passaria por estágio comum.
        fechado: e.metadata?.isClosed === true || e.metadata?.isClosed === 'true',
        ordem: e.displayOrder ?? 0,
      }))
      .sort((a, b) => a.ordem - b.ordem),
  }
}

/** Os pipelines de negócio deste portal, com seus estágios. */
export async function listarPipelines(
  accessToken: string,
  buscar?: Buscar,
): Promise<PipelineHubspot[] | { erro: string; semPermissao: boolean }> {
  const r = await requisitar(`${API}/crm/v3/pipelines/deals`, {
    metodo: 'GET',
    cabecalhos: { authorization: `Bearer ${accessToken}` },
    ...(buscar ? { buscar } : {}),
  })
  if (!r.ok) return { erro: r.erro ?? '', semPermissao: r.status === 403 }

  const c = r.corpo as { results?: Parameters<typeof lerPipeline>[0][] } | null
  return (c?.results ?? [])
    .map(lerPipeline)
    .filter((p): p is PipelineHubspot => p !== null)
    .sort((a, b) => a.ordem - b.ordem)
}

export interface NovoEstagio {
  rotulo: string
  /** Probabilidade de fechamento, de 0 a 1. O HubSpot exige nos estágios de
   *  fechamento: 1 para ganho, 0 para perdido. */
  probabilidade?: number
  fechado?: boolean
}

/** Cria um pipeline de negócios no portal do cliente.
 *
 *  Escrita estrutural no CRM de outra empresa — a coisa mais invasiva que a
 *  Avexa faz. Por isso é sempre um gesto explícito do operador, nunca algo que
 *  aconteça sozinho durante uma entrega. */
export async function criarPipeline(
  accessToken: string,
  rotulo: string,
  estagios: readonly NovoEstagio[],
  buscar?: Buscar,
): Promise<PipelineHubspot | { erro: string; semPermissao: boolean }> {
  if (!rotulo.trim()) return { erro: 'o pipeline precisa de um nome', semPermissao: false }
  if (estagios.length === 0) return { erro: 'um pipeline sem estágios não recebe negócio', semPermissao: false }

  const r = await requisitar(`${API}/crm/v3/pipelines/deals`, {
    cabecalhos: { authorization: `Bearer ${accessToken}` },
    corpo: {
      label: rotulo.trim(),
      displayOrder: -1,
      stages: estagios.map((e, i) => ({
        label: e.rotulo,
        displayOrder: i,
        metadata: {
          isClosed: String(e.fechado === true),
          probability: String(e.probabilidade ?? (e.fechado ? 1 : 0.5)),
        },
      })),
    },
    ...(buscar ? { buscar } : {}),
  })
  if (!r.ok) return { erro: r.erro ?? '', semPermissao: r.status === 403 }

  const p = lerPipeline((r.corpo ?? {}) as Parameters<typeof lerPipeline>[0])
  return p ?? { erro: 'o HubSpot criou o pipeline mas não devolveu o id', semPermissao: false }
}

export interface NegocioHubspot {
  nome: string
  pipeline: string
  estagio: string
  valor?: number | null | undefined
  /** Previsão de fechamento. */
  fechaEm?: Date | undefined
}

export type ResultadoNegocio =
  | { ok: true; id: string; criado: boolean }
  | { ok: false; erro: string; semPermissao: boolean; reenviavel: boolean }

/** Cria ou atualiza o negócio do lead. Associação 3 é a de negócio para
 *  contato, como 202 é a de nota e 200 a de reunião.
 *
 *  Atualiza quando já existe, pelo id que guardamos: lead reentregue não pode
 *  virar dois negócios no funil do cliente — o valor apareceria dobrado na
 *  previsão de vendas dele. */
export async function salvarNegocio(
  accessToken: string,
  contatoId: string,
  n: NegocioHubspot,
  negocioId?: string | undefined,
  buscar?: Buscar,
): Promise<ResultadoNegocio> {
  const propriedades: Record<string, string> = {
    dealname: n.nome,
    pipeline: n.pipeline,
    dealstage: n.estagio,
    ...(n.valor !== null && n.valor !== undefined ? { amount: String(n.valor) } : {}),
    ...(n.fechaEm ? { closedate: n.fechaEm.toISOString() } : {}),
  }
  const cab = { authorization: `Bearer ${accessToken}` }

  if (negocioId) {
    const patch = await requisitar(`${API}/crm/v3/objects/deals/${negocioId}`, {
      metodo: 'PATCH',
      cabecalhos: cab,
      corpo: { properties: propriedades },
      ...(buscar ? { buscar } : {}),
    })
    if (patch.ok) return { ok: true, id: negocioId, criado: false }
    // 404: apagaram o negócio no portal. Criar de novo é o certo.
    if (patch.status !== 404) {
      return {
        ok: false,
        erro: patch.erro ?? '',
        semPermissao: patch.status === 403,
        reenviavel: patch.reenviavel,
      }
    }
  }

  const criar = await requisitar(`${API}/crm/v3/objects/deals`, {
    cabecalhos: cab,
    corpo: {
      properties: propriedades,
      associations: [
        {
          to: { id: contatoId },
          types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 3 }],
        },
      ],
    },
    ...(buscar ? { buscar } : {}),
  })
  if (criar.ok) return { ok: true, id: (criar.corpo as { id?: string } | null)?.id ?? '', criado: true }
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
