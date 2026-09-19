import 'server-only'
import { and, desc, eq, gte } from 'drizzle-orm'
import {
  cliente,
  clienteCanal,
  db,
  entrega,
  execucao,
  fluxo,
  fluxoVersao,
  lead,
  supressao,
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

/* ---------------------------------------------------------------------------
 * Monitor de qualidade
 *
 * As perguntas que o monitor existe para responder não são "quantos leads" —
 * são "está saindo contato?", "o que está barrando?" e "tem lead parado?".
 * Este produto falha calado: um fluxo que pula WhatsApp em todo lead porque o
 * template não foi aprovado não gera erro nenhum, só silêncio.
 * ------------------------------------------------------------------------- */

export interface ResumoMonitor {
  dias: number
  kpis: {
    leads: number
    contatos: number
    respostas: number
    entregues: number
    suprimidosTotal: number
  }
  porCanal: Array<{
    canal: string
    tentativas: number
    entregues: number
    respondidas: number
    falhas: number
  }>
  /** Contatos por dia e por canal, para as pequenas séries. */
  serie: Array<{ dia: string; ligacao: number; whatsapp: number; sms: number; email: number }>
  bloqueios: Array<{ motivo: string; n: number }>
  /** O que aconteceu com o lead depois de qualificado. Um fluxo impecável que
   *  não entrega o lead é um fluxo que não serviu para nada. */
  entregas: Array<{ destino: string; entregues: number; falhas: number; semDestino: number }>
  falhasDeEntrega: Array<{ destino: string; erro: string | null; quando: Date }>
  paradas: Array<{ id: string; lead: string; fluxo: string; retomarEm: Date | null }>
  falhas: Array<{ canal: string; provedor: string | null; erro: string | null; quando: Date | null }>
}

const CANAIS_MONITOR = ['ligacao', 'whatsapp', 'sms', 'email'] as const

export async function resumoMonitor(
  s: Sessao,
  clienteId: string,
  dias = 14,
): Promise<ResumoMonitor> {
  const d = db()
  const desde = new Date(Date.now() - dias * 86_400_000)
  const alvo = s.permissoes.escopoCliente ? (s.clienteId ?? clienteId) : clienteId

  const [tentativas, leadsRecebidos, execucoesParadas, suprimidos, entregas] = await Promise.all([
    d
      .select({
        canal: tentativa.canal,
        estado: tentativa.estado,
        motivo: tentativa.motivo,
        provedor: tentativa.provedor,
        erro: tentativa.erro,
        criadoEm: tentativa.criadoEm,
        executadaEm: tentativa.executadaEm,
        respondidaEm: tentativa.respondidaEm,
      })
      .from(tentativa)
      .where(and(eq(tentativa.clienteId, alvo), gte(tentativa.criadoEm, desde))),
    d
      .select({ id: lead.id })
      .from(lead)
      .where(and(eq(lead.clienteId, alvo), gte(lead.criadoEm, desde))),
    d
      .select({
        id: execucao.id,
        retomarEm: execucao.retomarEm,
        leadNome: lead.nome,
        leadEmail: lead.email,
        fluxoNome: fluxo.nome,
      })
      .from(execucao)
      .innerJoin(lead, eq(lead.id, execucao.leadId))
      .innerJoin(fluxo, eq(fluxo.id, execucao.fluxoId))
      .where(and(eq(execucao.clienteId, alvo), eq(execucao.estado, 'aguardando')))
      .orderBy(execucao.retomarEm)
      .limit(25),
    d.select({ id: supressao.id }).from(supressao),
    d
      .select({
        destino: entrega.destino,
        estado: entrega.estado,
        erro: entrega.erro,
        criadoEm: entrega.criadoEm,
      })
      .from(entrega)
      .where(and(eq(entrega.clienteId, alvo), gte(entrega.criadoEm, desde))),
  ])

  const respondeu = (t: (typeof tentativas)[number]) => t.respondidaEm !== null

  /** O dia que conta é o do envio, não o da criação da linha: uma tentativa
   *  adiada pela janela nasce num dia e dispara em outro. */
  const quando = (t: (typeof tentativas)[number]) => t.executadaEm ?? t.criadoEm

  // Tabela e gráfico precisam concordar, então os dois usam a mesma base de data
  // e a mesma janela. Filtrar um por criação e o outro por envio produziria
  // "1 saiu" ao lado de "nenhum contato saiu" na mesma tela.
  const saiu = (t: (typeof tentativas)[number]) =>
    ['enviada', 'entregue', 'lida', 'respondida'].includes(t.estado) && quando(t) >= desde

  const porCanal = CANAIS_MONITOR.map((canal) => {
    const linhas = tentativas.filter((t) => t.canal === canal)
    return {
      canal,
      tentativas: linhas.filter(saiu).length,
      entregues: linhas.filter((t) => ['entregue', 'lida', 'respondida'].includes(t.estado)).length,
      respondidas: linhas.filter(respondeu).length,
      falhas: linhas.filter((t) => t.estado === 'falhou').length,
    }
  })

  // Uma linha por dia, inclusive os dias sem contato: um buraco no meio da série
  // é informação, e omitir o dia o esconderia.
  const serie: ResumoMonitor['serie'] = []
  for (let i = dias - 1; i >= 0; i--) {
    const dia = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10)
    // Indexado pelo dia em que o contato SAIU, não em que a tentativa foi
    // criada: uma tentativa adiada pela janela nasce num dia e dispara em
    // outro, e é o segundo que o operador está olhando.
    const doDia = tentativas.filter((t) => saiu(t) && quando(t).toISOString().slice(0, 10) === dia)
    serie.push({
      dia,
      ligacao: doDia.filter((t) => t.canal === 'ligacao').length,
      whatsapp: doDia.filter((t) => t.canal === 'whatsapp').length,
      sms: doDia.filter((t) => t.canal === 'sms').length,
      email: doDia.filter((t) => t.canal === 'email').length,
    })
  }

  const contagem = new Map<string, number>()
  for (const t of tentativas) {
    if (t.motivo) contagem.set(t.motivo, (contagem.get(t.motivo) ?? 0) + 1)
  }

  return {
    dias,
    kpis: {
      leads: leadsRecebidos.length,
      contatos: tentativas.filter(saiu).length,
      respostas: tentativas.filter(respondeu).length,
      entregues: entregas.filter((e) => e.estado === 'entregue').length,
      suprimidosTotal: suprimidos.length,
    },
    porCanal,
    serie,
    bloqueios: [...contagem.entries()]
      .map(([motivo, n]) => ({ motivo, n }))
      .sort((a, b) => b.n - a.n),
    paradas: execucoesParadas.map((e) => ({
      id: e.id,
      lead: e.leadNome ?? e.leadEmail ?? '—',
      fluxo: e.fluxoNome,
      retomarEm: e.retomarEm,
    })),
    falhas: tentativas
      .filter((t) => t.estado === 'falhou' && t.erro)
      .sort((a, b) => (b.executadaEm?.getTime() ?? 0) - (a.executadaEm?.getTime() ?? 0))
      .slice(0, 10)
      .map((t) => ({ canal: t.canal, provedor: t.provedor, erro: t.erro, quando: t.executadaEm })),
    entregas: [...new Set(entregas.map((e) => e.destino))].map((destino) => {
      const linhas = entregas.filter((e) => e.destino === destino)
      return {
        destino,
        entregues: linhas.filter((e) => e.estado === 'entregue').length,
        falhas: linhas.filter((e) => e.estado === 'falhou').length,
        semDestino: linhas.filter((e) => e.estado === 'sem_destino').length,
      }
    }),
    falhasDeEntrega: entregas
      .filter((e) => e.estado === 'falhou' || e.estado === 'sem_destino')
      .sort((a, b) => b.criadoEm.getTime() - a.criadoEm.getTime())
      .slice(0, 10)
      .map((e) => ({ destino: e.destino, erro: e.erro, quando: e.criadoEm })),
  }
}
