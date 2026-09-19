import { randomBytes } from 'node:crypto'
import { and, desc, eq } from 'drizzle-orm'
import { entrega, integracao, reuniao, type Db, type Lead } from '@avexa/db'
import { salvarContato, criarNota, type ContatoHubspot } from '@avexa/adapters'
import { cifrar, decifrar } from './cripto.ts'
import { conexaoHubspot, statusParaGravar } from './hubspot.ts'

/** Entrega do lead onde o cliente trabalha.
 *
 *  Dois princípios valem para todos os destinos:
 *
 *  - **Toda entrega deixa registro**, inclusive a que não aconteceu. Destino não
 *    configurado, token expirado, webhook do cliente fora do ar: se isso some,
 *    o primeiro a descobrir é o comercial reclamando que não chega lead.
 *  - **A mesma carga para todos.** O que vai no webhook é o que vai no HubSpot é
 *    o que vai no e-mail. Formatos diferentes por destino viram, com o tempo,
 *    campos que só existem em um lugar. */

export type DestinoEntrega =
  | 'hubspot'
  | 'email_time'
  | 'google_sheets'
  | 'webhook'
  | 'webhook_saida'

export interface CargaLead {
  id: string
  nome: string | null
  telefone: string | null
  email: string | null
  score: number | null
  motivo: string | null
  resumo: string | null
  etiquetas: string[]
  campos: Record<string, unknown>
  utm: Record<string, string>
  criadoEm: string
  urgente: boolean
  reuniao?: {
    status: string
    provedor: string
    inicio: string | null
    link: string | null
  }
}

export async function cargaDoLead(
  db: Db,
  ld: Lead,
  urgente = false,
): Promise<CargaLead> {
  const [r] = await db
    .select()
    .from(reuniao)
    .where(eq(reuniao.leadId, ld.id))
    .orderBy(desc(reuniao.criadoEm))
    .limit(1)

  return {
    id: ld.id,
    nome: ld.nome,
    telefone: ld.telefone,
    email: ld.email,
    score: ld.score,
    motivo: ld.scoreMotivo,
    resumo: ld.resumo,
    etiquetas: ld.etiquetas ?? [],
    campos: (ld.campos ?? {}) as Record<string, unknown>,
    utm: (ld.utm ?? {}) as Record<string, string>,
    criadoEm: ld.criadoEm.toISOString(),
    urgente,
    // A reunião é o que o comercial quer saber primeiro. Sem ela na carga, ele
    // abre o CRM, vê "lead qualificado" e não sabe se já tem hora marcada.
    ...(r
      ? {
          reuniao: {
            status: r.status,
            provedor: r.provedor,
            inicio: r.inicio?.toISOString() ?? null,
            link: r.linkAgendamento ?? r.linkEvento ?? null,
          },
        }
      : {}),
  }
}

export interface RegistroEntrega {
  leadId: string
  clienteId: string
  execucaoId?: string | undefined
  etapaId?: string | undefined
  destino: DestinoEntrega
  estado: 'entregue' | 'falhou' | 'sem_destino' | 'seco'
  urgente?: boolean
  tentativas?: number
  externoId?: string | undefined
  url?: string | undefined
  httpStatus?: number | undefined
  erro?: string | undefined
  dryRun?: boolean
}

export async function registrarEntrega(db: Db, r: RegistroEntrega): Promise<string> {
  const [linha] = await db
    .insert(entrega)
    .values({
      leadId: r.leadId,
      clienteId: r.clienteId,
      ...(r.execucaoId ? { execucaoId: r.execucaoId } : {}),
      ...(r.etapaId ? { etapaId: r.etapaId } : {}),
      destino: r.destino,
      estado: r.estado,
      urgente: r.urgente ?? false,
      tentativas: r.tentativas ?? 1,
      ...(r.externoId ? { externoId: r.externoId } : {}),
      ...(r.url ? { url: r.url } : {}),
      ...(r.httpStatus !== undefined ? { httpStatus: r.httpStatus } : {}),
      // Erro de fornecedor pode vir com o corpo inteiro da resposta; o que
      // interessa está no começo.
      ...(r.erro ? { erro: r.erro.slice(0, 1000) } : {}),
      dryRun: r.dryRun ?? false,
    })
    .returning({ id: entrega.id })
  return linha!.id
}

export async function entregasDoLead(db: Db, leadId: string) {
  return db.select().from(entrega).where(eq(entrega.leadId, leadId)).orderBy(desc(entrega.criadoEm))
}

/* ------------------------------- webhook -------------------------------- */

const CTX_WEBHOOK = (clienteId: string) => `${clienteId}:webhook`

/** https na internet; http só em localhost.
 *
 *  A exigência existe porque a carga leva nome, telefone e e-mail do lead. A
 *  exceção existe porque o cliente testa a integração dele na própria máquina
 *  antes de publicar, e forçar https aí só empurra todo mundo para um túnel. */
export function urlDeWebhookValida(url: string): boolean {
  try {
    const u = new URL(url)
    if (u.protocol === 'https:') return true
    return u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)
  } catch {
    return false
  }
}

/** URL e segredo do webhook do cliente.
 *
 *  O segredo é nosso para gerar, não do cliente para inventar: um segredo que
 *  alguém escolhe à mão costuma ser curto e reutilizado. */
export async function definirWebhookDoCliente(
  db: Db,
  clienteId: string,
  url: string,
  regerarSegredo = false,
): Promise<{ ok: boolean; segredo?: string; erro?: string }> {
  if (url && !urlDeWebhookValida(url)) {
    return { ok: false, erro: 'A URL precisa ser https: sem isso a carga do lead trafega em claro.' }
  }

  const [existente] = await db
    .select()
    .from(integracao)
    .where(and(eq(integracao.clienteId, clienteId), eq(integracao.tipo, 'webhook')))
    .limit(1)

  const anterior = existente ? decifrar(existente.segredo, CTX_WEBHOOK(clienteId)) : null
  const segredo = !anterior || regerarSegredo ? `whsec_${randomBytes(24).toString('hex')}` : anterior
  const cifrado = cifrar(segredo, CTX_WEBHOOK(clienteId))

  if (existente) {
    await db
      .update(integracao)
      .set({ config: { ...(existente.config ?? {}), url }, segredo: cifrado, ativo: true })
      .where(eq(integracao.id, existente.id))
  } else {
    await db.insert(integracao).values({
      clienteId,
      tipo: 'webhook',
      nome: 'Webhook do cliente',
      config: { url },
      segredo: cifrado,
      ativo: true,
    })
  }

  return { ok: true, segredo }
}

export async function webhookDoCliente(
  db: Db,
  clienteId: string,
): Promise<{ url: string; segredo: string | null } | null> {
  const [linha] = await db
    .select()
    .from(integracao)
    .where(
      and(
        eq(integracao.clienteId, clienteId),
        eq(integracao.tipo, 'webhook'),
        eq(integracao.ativo, true),
      ),
    )
    .limit(1)
  if (!linha) return null
  const url = (linha.config as { url?: string }).url
  if (!url) return null
  return { url, segredo: decifrar(linha.segredo, CTX_WEBHOOK(clienteId)) }
}

/* ------------------------------- HubSpot -------------------------------- */

export interface ResultadoDestino {
  ok: boolean
  externoId?: string
  erro?: string
  reenviavel?: boolean
  /** O que funcionou pela metade e o operador precisa saber. */
  aviso?: string
}

/** Grava o lead no CRM do cliente: contato com upsert e a conversa como nota. */
export async function entregarNoHubspot(
  db: Db,
  clienteId: string,
  ld: Lead,
  carga: CargaLead,
): Promise<ResultadoDestino> {
  const conexao = await conexaoHubspot(db, clienteId)
  if ('erro' in conexao) {
    return { ok: false, erro: conexao.erro, reenviavel: !conexao.precisaReconectar }
  }

  const qualificado = (ld.score ?? 0) >= 60
  const [nome, ...resto] = (ld.nome ?? '').trim().split(/\s+/)
  const props = conexao.config.propriedadesOk !== false

  const contato: ContatoHubspot = {
    email: ld.email,
    telefone: ld.telefone,
    nome: nome || null,
    sobrenome: resto.join(' ') || null,
    statusLead: statusParaGravar(conexao.config as Record<string, unknown>, qualificado),
    // Sem as propriedades criadas no portal, mandar score e resumo devolve 400
    // e leva o contato junto. Melhor o contato sem eles do que nada.
    ...(props
      ? {
          score: ld.score,
          resumo: ld.resumo,
          etiquetas: ld.etiquetas ?? [],
          origem: carga.utm.utm_source ?? 'avexa',
        }
      : {}),
  }

  const r = await salvarContato(conexao.accessToken, contato)
  if (!r.ok) return { ok: false, erro: r.erro, reenviavel: r.reenviavel }

  let aviso: string | undefined
  if (ld.resumo || ld.scoreMotivo) {
    const linhas = [
      `Lead trabalhado pela Avexa · score ${ld.score ?? '—'}`,
      ld.scoreMotivo ? `Motivo: ${ld.scoreMotivo}` : '',
      ld.resumo ? `\n${ld.resumo}` : '',
      carga.reuniao?.inicio ? `\nReunião: ${carga.reuniao.inicio}` : '',
      carga.reuniao?.link && !carga.reuniao.inicio ? `\nLink de agenda: ${carga.reuniao.link}` : '',
    ].filter(Boolean)

    const nota = await criarNota(conexao.accessToken, r.id, linhas.join('\n'))
    if (!nota.ok) {
      aviso = nota.semPermissao
        ? 'O contato foi gravado, mas o app não tem permissão de criar notas neste portal.'
        : `O contato foi gravado, mas a nota falhou: ${nota.erro}`
    }
  }

  return { ok: true, externoId: r.id, ...(aviso ? { aviso } : {}) }
}
