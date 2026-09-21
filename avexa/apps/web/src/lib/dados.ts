import 'server-only'
import { and, asc, desc, eq, gt, gte, inArray, lt, or } from 'drizzle-orm'
import {
  cliente,
  clienteCanal,
  db,
  entrega,
  execucao,
  fluxo,
  fluxoVersao,
  integracao,
  lead,
  numero,
  reuniao,
  supressao,
  template,
  tentativa,
} from '@avexa/db'
import { CORTE_QUALIFICADO, type Grafo } from '@avexa/core'
import {
  POR_PAGINA,
  cursorParaTexto,
  fronteiras,
  type Cursor,
  type NumeroDoResumo,
  type Periodo,
} from './resumo'
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

/** Números livres, para a ativação oferecer "usar um que já temos".
 *
 *  Só quem administra vê: número livre é recurso da operação, não do cliente. */
export async function numerosLivres(s: Sessao) {
  if (!s.permissoes.administrar) return []
  return db()
    .select({ e164: numero.e164, capacidades: numero.capacidades })
    .from(numero)
    .where(eq(numero.status, 'livre'))
    .orderBy(numero.e164)
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

/** As agendas que o cliente escolheu em Integrações, para o construtor mostrar
 *  como destinos do nó de agendamento.
 *
 *  Lê da configuração salva, não do Google: abrir o construtor não deve depender
 *  de a conta do cliente estar respondendo agora. Quem atualiza essa lista é a
 *  tela de Integrações, que é onde a escolha é feita. */
export async function agendasDoCliente(
  clienteId: string,
): Promise<Array<{ id: string; nome: string }>> {
  const [linha] = await db()
    .select({ config: integracao.config })
    .from(integracao)
    .where(
      and(
        eq(integracao.clienteId, clienteId),
        eq(integracao.tipo, 'google_calendar'),
        eq(integracao.ativo, true),
      ),
    )
    .limit(1)

  const cfg = (linha?.config ?? {}) as Record<string, unknown>
  const ids = (cfg.calendarios as string[] | undefined) ?? []
  const nomes = (cfg.calendariosNomes as Record<string, string> | undefined) ?? {}
  return ids.map((id) => ({ id, nome: nomes[id] ?? id }))
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

export interface EntregaDoLead {
  destino: string
  estado: string
  erro: string | null
  externoId: string | null
  quando: Date
}

export interface ReuniaoDoLead {
  status: string
  provedor: string
  inicio: Date | null
  responsavel: string | null
  motivoCancelamento: string | null
  link: string | null
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
  /** Onde este lead foi parar. Vazio enquanto o fluxo não chegou à etapa de
   *  saída — que é diferente de ter tentado e não ter chegado. */
  entregas: EntregaDoLead[]
  /** A mais recente. Uma reunião cancelada não vira histórico: é o estado atual
   *  do lead, e mostrar a marcação antiga no lugar dela seria mentira. */
  reuniao: ReuniaoDoLead | null
}

export interface PaginaDeLeads {
  leads: LeadNaLista[]
  /** Cursores para as setas. `null` quando aquele lado acabou — é o que
   *  desabilita o botão em vez de levar a uma página vazia. */
  anterior: string | null
  proxima: string | null
}

export interface PedidoDeLeads {
  dias?: number
  /** Página seguinte, a partir deste ponto (mais antigos que ele). */
  depois?: Cursor | null
  /** Página anterior (mais novos que ele). */
  antes?: Cursor | null
  limite?: number
}

export async function listarLeads(
  s: Sessao,
  clienteId: string,
  p: PedidoDeLeads = {},
): Promise<PaginaDeLeads> {
  const vazia: PaginaDeLeads = { leads: [], anterior: null, proxima: null }
  if (!s.permissoes.verLeads) return vazia
  // O papel cliente só enxerga o próprio cliente, venha o que vier na URL.
  const alvo = s.permissoes.escopoCliente ? s.clienteId : clienteId
  if (!alvo) return vazia

  const { dias } = p
  const limite = p.limite ?? POR_PAGINA
  // Os dois sentidos juntos na URL pedem linhas mais novas E mais antigas que
  // cursores diferentes: o resultado seria sempre vazio. Voltar ganha, porque
  // é o clique mais recente de quem montou essa URL.
  const antes = p.antes ?? null
  const depois = antes ? null : (p.depois ?? null)
  // Voltar é a mesma consulta de trás para frente: pega os mais NOVOS que o
  // cursor em ordem crescente e inverte no fim. Sem isso, "anterior" precisaria
  // guardar a pilha de páginas visitadas, que se perde ao recarregar.
  const voltando = antes !== null

  const d = db()
  // Sem join com execução: um lead pode ter mais de uma (entrou de novo por
  // outro fluxo), e o join devolveria a mesma pessoa em duas linhas — que é
  // exatamente o que esta tela não pode fazer, porque lead duplicado é uma das
  // coisas que o operador vem aqui conferir.
  const leads = await d
    .select({
      id: lead.id,
      nome: lead.nome,
      telefone: lead.telefone,
      email: lead.email,
      score: lead.score,
      resumo: lead.resumo,
      criadoEm: lead.criadoEm,
    })
    .from(lead)
    .where(
      and(
        eq(lead.clienteId, alvo),
        // A mesma janela do resumo no topo. Resumo de 30 dias em cima de uma
        // lista sem recorte mostraria "12 leads" acima de uma tabela com 80
        // linhas, e quem lê não tem como saber qual dos dois está certo.
        ...(dias ? [gte(lead.criadoEm, new Date(Date.now() - dias * 86_400_000))] : []),
        // A comparação é sobre o par (data, id), não só sobre a data: leads do
        // mesmo formulário caem no mesmo milissegundo, e comparar só a data
        // pularia um deles na virada da página.
        ...(depois
          ? [
              or(
                lt(lead.criadoEm, depois.criadoEm),
                and(eq(lead.criadoEm, depois.criadoEm), lt(lead.id, depois.id)),
              )!,
            ]
          : []),
        ...(antes
          ? [
              or(
                gt(lead.criadoEm, antes.criadoEm),
                and(eq(lead.criadoEm, antes.criadoEm), gt(lead.id, antes.id)),
              )!,
            ]
          : []),
      ),
    )
    .orderBy(
      voltando ? asc(lead.criadoEm) : desc(lead.criadoEm),
      voltando ? asc(lead.id) : desc(lead.id),
    )
    // Uma linha a mais do que cabe na página: é ela que diz se existe página
    // seguinte, sem uma segunda consulta de contagem.
    .limit(limite + 1)

  const temMais = leads.length > limite
  const pagina = leads.slice(0, limite)
  // Voltando, a consulta veio de trás para frente. A tela sempre mostra do mais
  // novo para o mais antigo.
  if (voltando) pagina.reverse()

  const primeiro = pagina[0]
  const ultimo = pagina[pagina.length - 1]

  const setas = fronteiras({
    voltando,
    comCursor: depois !== null,
    temMais,
    vazia: pagina.length === 0,
  })
  const anterior = setas.anterior && primeiro ? cursorParaTexto(primeiro) : null
  const proxima = setas.proxima && ultimo ? cursorParaTexto(ultimo) : null

  const ids = pagina.map((l) => l.id)
  if (ids.length === 0) return vazia

  // Limitado aos leads desta página: carregar as tentativas do cliente inteiro
  // cresce com a base e esta tela é a mais aberta do painel.
  const [execucoes, contagens, entregas, reunioes] = await Promise.all([
    d
      .select({
        leadId: execucao.leadId,
        estado: execucao.estado,
        motivo: execucao.motivoEncerramento,
      })
      .from(execucao)
      .where(inArray(execucao.leadId, ids))
      .orderBy(desc(execucao.iniciadoEm)),
    d
      .select({ leadId: tentativa.leadId, estado: tentativa.estado })
      .from(tentativa)
      .where(inArray(tentativa.leadId, ids)),
    d
      .select({
        leadId: entrega.leadId,
        destino: entrega.destino,
        estado: entrega.estado,
        erro: entrega.erro,
        externoId: entrega.externoId,
        criadoEm: entrega.criadoEm,
      })
      .from(entrega)
      .where(inArray(entrega.leadId, ids))
      .orderBy(desc(entrega.criadoEm)),
    d
      .select({
        leadId: reuniao.leadId,
        status: reuniao.status,
        provedor: reuniao.provedor,
        inicio: reuniao.inicio,
        responsavel: reuniao.responsavel,
        motivoCancelamento: reuniao.motivoCancelamento,
        linkEvento: reuniao.linkEvento,
        linkAgendamento: reuniao.linkAgendamento,
      })
      .from(reuniao)
      .where(inArray(reuniao.leadId, ids))
      .orderBy(desc(reuniao.criadoEm)),
  ])

  // A execução mais recente é a que a tela mostra: é o estado atual do lead.
  const porExecucao = new Map<string, { estado: string; motivo: string | null }>()
  for (const e of execucoes) {
    if (!porExecucao.has(e.leadId)) porExecucao.set(e.leadId, { estado: e.estado, motivo: e.motivo })
  }

  const porLead = new Map<string, number>()
  for (const c of contagens) {
    if (['enviada', 'entregue', 'lida', 'respondida'].includes(c.estado)) {
      porLead.set(c.leadId, (porLead.get(c.leadId) ?? 0) + 1)
    }
  }

  // Uma linha por destino: a última tentativa é a que vale. Um webhook que
  // falhou e foi reenviado com sucesso está entregue, e mostrar as duas linhas
  // faria parecer problema onde já não há.
  const entregasPorLead = new Map<string, EntregaDoLead[]>()
  for (const e of entregas) {
    const lista = entregasPorLead.get(e.leadId) ?? []
    if (!lista.some((x) => x.destino === e.destino)) {
      lista.push({
        destino: e.destino,
        estado: e.estado,
        erro: e.erro,
        externoId: e.externoId,
        quando: e.criadoEm,
      })
    }
    entregasPorLead.set(e.leadId, lista)
  }

  const reuniaoPorLead = new Map<string, ReuniaoDoLead>()
  for (const r of reunioes) {
    if (reuniaoPorLead.has(r.leadId)) continue
    reuniaoPorLead.set(r.leadId, {
      status: r.status,
      provedor: r.provedor,
      inicio: r.inicio,
      responsavel: r.responsavel,
      motivoCancelamento: r.motivoCancelamento,
      link: r.linkEvento ?? r.linkAgendamento,
    })
  }

  return {
    leads: pagina.map((l) => ({
      ...l,
      estado: porExecucao.get(l.id)?.estado ?? null,
      motivo: porExecucao.get(l.id)?.motivo ?? null,
      contatos: porLead.get(l.id) ?? 0,
      entregas: entregasPorLead.get(l.id) ?? [],
      reuniao: reuniaoPorLead.get(l.id) ?? null,
    })),
    anterior,
    proxima,
  }
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
        leadId: entrega.leadId,
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
      // Leads, não linhas: um lead pode ter várias entregas (CRM, webhook, e a
      // reunião subindo de novo a cada remarcação), e contar linhas faria este
      // número passar do total de leads recebidos.
      entregues: new Set(
        entregas.filter((e) => e.estado === 'entregue').map((e) => e.leadId),
      ).size,
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

/* ---------------------------------------------------------------------------
 * Resumo da tela de leads
 * ------------------------------------------------------------------------- */

export interface ResumoDeLeads {
  dias: number
  recebidos: NumeroDoResumo
  qualificados: NumeroDoResumo
  reunioes: NumeroDoResumo
  entregues: NumeroDoResumo
  /** Quantos leads existem no período, para a lista dizer que está truncada. */
  total: number
}

/** Os quatro números que respondem "o que aconteceu com os meus leads".
 *
 *  Consulta própria, e não o `resumoMonitor`: aquele é a tela de diagnóstico da
 *  operação — carrega erro de provedor, execuções travadas e uma contagem de
 *  supressão que não é escopada por cliente. Nada disso pode aparecer para o
 *  cliente final. E ele também não tem o número que mais importa aqui, que é
 *  reunião marcada.
 *
 *  A reunião conta pela data em que foi MARCADA, não pela data em que acontece:
 *  o trabalho foi feito no período, mesmo que a conversa seja no mês que vem. */
export async function resumoDeLeads(
  s: Sessao,
  clienteId: string,
  dias: Periodo = 30,
): Promise<ResumoDeLeads | null> {
  if (!s.permissoes.verLeads) return null
  // Mesmo estreitamento da lista: o papel cliente nunca sai do próprio cliente,
  // venha o que vier na URL.
  const alvo = s.permissoes.escopoCliente ? s.clienteId : clienteId
  if (!alvo) return null

  const d = db()
  const agora = Date.now()
  const inicio = new Date(agora - dias * 86_400_000)
  const inicioAnterior = new Date(agora - 2 * dias * 86_400_000)

  // Uma leitura só, cobrindo os dois períodos, e a divisão é feita aqui: duas
  // idas ao banco por métrica seriam oito consultas para quatro números.
  const [leads, reunioes, entregas] = await Promise.all([
    d
      .select({ criadoEm: lead.criadoEm, score: lead.score })
      .from(lead)
      .where(and(eq(lead.clienteId, alvo), gte(lead.criadoEm, inicioAnterior))),
    d
      .select({ criadoEm: reuniao.criadoEm })
      .from(reuniao)
      .where(
        and(
          eq(reuniao.clienteId, alvo),
          eq(reuniao.status, 'marcada'),
          gte(reuniao.criadoEm, inicioAnterior),
        ),
      ),
    d
      .select({ leadId: entrega.leadId, criadoEm: entrega.criadoEm })
      .from(entrega)
      .where(
        and(
          eq(entrega.clienteId, alvo),
          eq(entrega.estado, 'entregue'),
          gte(entrega.criadoEm, inicioAnterior),
        ),
      ),
  ])

  const noPeriodo = <T extends { criadoEm: Date }>(linhas: T[]) =>
    linhas.filter((l) => l.criadoEm >= inicio)
  const noAnterior = <T extends { criadoEm: Date }>(linhas: T[]) =>
    linhas.filter((l) => l.criadoEm < inicio)

  // Sem nada no período anterior não há comparação honesta a fazer. O primeiro
  // mês de um cliente mostraria "+100%" em tudo, que é ruído com cara de
  // resultado.
  const houveAnterior =
    noAnterior(leads).length > 0 || noAnterior(reunioes).length > 0 || noAnterior(entregas).length > 0

  const par = (atual: number, anterior: number): NumeroDoResumo => ({
    valor: atual,
    anterior: houveAnterior ? anterior : null,
  })

  const qualificado = (l: { score: number | null }) => (l.score ?? 0) >= CORTE_QUALIFICADO

  // Leads distintos, não linhas de entrega: um lead vai para o CRM, para o
  // webhook e sobe de novo a cada remarcação. Contar linhas faria "entregues"
  // passar de "recebidos" na mesma tela.
  const distintos = (linhas: Array<{ leadId: string }>) => new Set(linhas.map((e) => e.leadId)).size

  return {
    dias,
    recebidos: par(noPeriodo(leads).length, noAnterior(leads).length),
    qualificados: par(
      noPeriodo(leads).filter(qualificado).length,
      noAnterior(leads).filter(qualificado).length,
    ),
    reunioes: par(noPeriodo(reunioes).length, noAnterior(reunioes).length),
    entregues: par(distintos(noPeriodo(entregas)), distintos(noAnterior(entregas))),
    total: noPeriodo(leads).length,
  }
}
