import 'server-only'
import { and, desc, eq } from 'drizzle-orm'
import {
  cliente,
  clienteCanal,
  db,
  execucao,
  fluxo,
  fluxoVersao,
  lead,
  template,
  tentativa,
} from '@avexa/db'
import type { Grafo } from '@avexa/core'
import type { Sessao } from './auth'

/** Consultas do painel.
 *
 *  Todas recebem a sessão e aplicam o escopo aqui, no servidor. O papel
 *  `cliente` nunca consegue ler além do próprio `clienteId` porque a cláusula
 *  não é opcional — não depende de a tela lembrar de filtrar. */

export async function listarClientes(s: Sessao) {
  if (!s.permissoes.verClientes) return []
  return db().select().from(cliente).orderBy(cliente.nome)
}

export async function clientePadrao(s: Sessao, slug?: string) {
  const d = db()
  if (s.permissoes.escopoCliente) {
    if (!s.clienteId) return null
    const [c] = await d.select().from(cliente).where(eq(cliente.id, s.clienteId)).limit(1)
    return c ?? null
  }
  if (slug) {
    const [c] = await d.select().from(cliente).where(eq(cliente.slug, slug)).limit(1)
    if (c) return c
  }
  const [c] = await d.select().from(cliente).orderBy(cliente.nome).limit(1)
  return c ?? null
}

export async function canaisDoCliente(clienteId: string) {
  const linhas = await db()
    .select()
    .from(clienteCanal)
    .where(eq(clienteCanal.clienteId, clienteId))
  return Object.fromEntries(linhas.map((l) => [l.canal, l.ativo])) as Record<string, boolean>
}

export async function listarFluxos(clienteId: string) {
  return db().select().from(fluxo).where(eq(fluxo.clienteId, clienteId)).orderBy(fluxo.criadoEm)
}

export async function carregarFluxo(fluxoId: string) {
  const d = db()
  const [f] = await d.select().from(fluxo).where(eq(fluxo.id, fluxoId)).limit(1)
  if (!f) return null

  // A versão publicada é a que recebe leads; um rascunho mais novo pode existir.
  const [v] = await d
    .select()
    .from(fluxoVersao)
    .where(eq(fluxoVersao.fluxoId, f.id))
    .orderBy(desc(fluxoVersao.versao))
    .limit(1)

  return { fluxo: f, versao: v ?? null, grafo: (v?.grafo ?? []) as Grafo }
}

export async function listarTemplates(clienteId: string, canal?: string) {
  const d = db()
  return d
    .select()
    .from(template)
    .where(
      canal
        ? and(
            eq(template.clienteId, clienteId),
            eq(template.canal, canal as 'email'),
            eq(template.arquivado, false),
          )
        : and(eq(template.clienteId, clienteId), eq(template.arquivado, false)),
    )
    .orderBy(template.nome)
}

export interface LeadNaLista {
  id: string
  nome: string | null
  telefone: string | null
  email: string | null
  score: number | null
  resumo: string | null
  criadoEm: Date
  estado: string | null
  motivo: string | null
  contatos: number
}

export async function listarLeads(s: Sessao, clienteId: string, limite = 100): Promise<LeadNaLista[]> {
  if (!s.permissoes.verLeads) return []
  // O papel cliente só enxerga o próprio cliente, venha o que vier na URL.
  const alvo = s.permissoes.escopoCliente ? s.clienteId : clienteId
  if (!alvo) return []

  const d = db()
  const linhas = await d
    .select({
      id: lead.id,
      nome: lead.nome,
      telefone: lead.telefone,
      email: lead.email,
      score: lead.score,
      resumo: lead.resumo,
      criadoEm: lead.criadoEm,
      estado: execucao.estado,
      motivo: execucao.motivoEncerramento,
    })
    .from(lead)
    .leftJoin(execucao, eq(execucao.leadId, lead.id))
    .where(eq(lead.clienteId, alvo))
    .orderBy(desc(lead.criadoEm))
    .limit(limite)

  const contagens = await d
    .select({ leadId: tentativa.leadId, estado: tentativa.estado })
    .from(tentativa)
    .where(eq(tentativa.clienteId, alvo))

  const porLead = new Map<string, number>()
  for (const c of contagens) {
    if (['enviada', 'entregue', 'lida', 'respondida'].includes(c.estado)) {
      porLead.set(c.leadId, (porLead.get(c.leadId) ?? 0) + 1)
    }
  }

  return linhas.map((l) => ({ ...l, contatos: porLead.get(l.id) ?? 0 }))
}

export async function tentativasDoLead(s: Sessao, leadId: string) {
  if (!s.permissoes.verLeads) return []
  const d = db()
  const [l] = await d.select().from(lead).where(eq(lead.id, leadId)).limit(1)
  if (!l) return []
  if (s.permissoes.escopoCliente && l.clienteId !== s.clienteId) return []

  return d.select().from(tentativa).where(eq(tentativa.leadId, leadId)).orderBy(tentativa.criadoEm)
}
