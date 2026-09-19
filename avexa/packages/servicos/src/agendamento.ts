import { and, desc, eq } from 'drizzle-orm'
import { cliente, lead, reuniao, type Db } from '@avexa/db'
import { adaptadorCalendly, adaptadorGoogleAgenda } from '@avexa/adapters'
import type {
  AdaptadorAgenda,
  LimitesMotor,
  PedidoReuniao,
  ProvedorAgenda,
  ResultadoReuniao,
  ReuniaoConfirmada,
} from '@avexa/core'
import { conexaoCalendly } from './calendly.ts'
import { conexaoGoogle } from './google.ts'

/** Agendamento com a ferramenta do cliente.
 *
 *  O produto não impõe calendário. Quem agenda é o que o cliente já usa, e o
 *  motor só pede uma reunião: o adaptador decide se marca direto ou devolve um
 *  link para o lead escolher. Acrescentar Cal.com ou Microsoft Bookings é
 *  escrever mais um adaptador — nenhum fluxo de cliente precisa mudar. */

/** Qual ferramenta este cliente usa.
 *
 *  Quando os dois estão conectados, vale a preferência gravada; sem preferência,
 *  o Calendly ganha, porque conectá-lo é um gesto mais deliberado do que ter o
 *  Google ligado para planilha. */
export async function provedorDoCliente(
  db: Db,
  clienteId: string,
): Promise<ProvedorAgenda | null> {
  const [c] = await db.select().from(cliente).where(eq(cliente.id, clienteId)).limit(1)
  const preferido = c?.provedorAgenda as ProvedorAgenda | null | undefined

  const calendly = await conexaoCalendly(db, clienteId)
  const google = await conexaoGoogle(db, clienteId, 'google_calendar')

  const temCalendly = !('erro' in calendly)
  const temGoogle = !('erro' in google)

  if (preferido === 'calendly' && temCalendly) return 'calendly'
  if (preferido === 'google_calendar' && temGoogle) return 'google_calendar'
  if (temCalendly) return 'calendly'
  if (temGoogle) return 'google_calendar'
  return null
}

export async function criarAdaptadorAgenda(
  db: Db,
  clienteId: string,
  limites: LimitesMotor,
  rodizio?: boolean,
): Promise<AdaptadorAgenda | { erro: string; precisaReconectar?: boolean }> {
  const provedor = await provedorDoCliente(db, clienteId)
  if (!provedor) {
    return { erro: 'nenhuma ferramenta de agenda conectada', precisaReconectar: true }
  }

  if (provedor === 'calendly') {
    const conexao = await conexaoCalendly(db, clienteId)
    if ('erro' in conexao) return conexao
    const tipoDeEventoUri = conexao.config.tipoDeEvento as string | undefined
    if (!tipoDeEventoUri) {
      return { erro: 'nenhum tipo de evento escolhido no Calendly deste cliente' }
    }
    return adaptadorCalendly({ accessToken: conexao.accessToken, tipoDeEventoUri })
  }

  const conexao = await conexaoGoogle(db, clienteId, 'google_calendar')
  if ('erro' in conexao) return conexao
  return adaptadorGoogleAgenda({
    accessToken: conexao.accessToken,
    calendarios: (conexao.config.calendarios as string[] | undefined) ?? [],
    // A etapa do fluxo manda: é onde o operador escolheu "rodízio entre
    // consultores". Sem etapa dizendo nada, vale o que ficou na integração.
    rodizio: rodizio ?? conexao.config.rodizio !== false,
    limites,
  })
}

export interface PedidoAgendamento extends PedidoReuniao {
  clienteId: string
  leadId: string
  execucaoId?: string
  limites: LimitesMotor
  rodizio?: boolean
}

/** Oferece a reunião e registra o que aconteceu.
 *
 *  O registro nasce em estados diferentes por fornecedor, e isso é a diferença
 *  real entre eles: marcação direta nasce `marcada`; link nasce `oferecida` e
 *  vira `marcada` quando o webhook avisar que o lead escolheu. */
export async function oferecerReuniao(
  db: Db,
  p: PedidoAgendamento,
): Promise<ResultadoReuniao & { provedor?: ProvedorAgenda }> {
  const adaptador = await criarAdaptadorAgenda(db, p.clienteId, p.limites, p.rodizio)
  if ('erro' in adaptador) {
    return {
      tipo: 'falhou',
      erro: adaptador.erro,
      ...(adaptador.precisaReconectar ? { precisaReconectar: true } : {}),
    }
  }

  const r = await adaptador.oferecer({
    titulo: p.titulo,
    ...(p.descricao ? { descricao: p.descricao } : {}),
    duracaoMin: p.duracaoMin,
    ...(p.lembreteMin !== undefined ? { lembreteMin: p.lembreteMin } : {}),
    emailDoLead: p.emailDoLead,
    ...(p.nomeDoLead ? { nomeDoLead: p.nomeDoLead } : {}),
    fusoDoLead: p.fusoDoLead,
    de: p.de,
  })

  if (r.tipo === 'falhou') return { ...r, provedor: adaptador.provedor }

  await db.insert(reuniao).values({
    leadId: p.leadId,
    clienteId: p.clienteId,
    ...(p.execucaoId ? { execucaoId: p.execucaoId } : {}),
    provedor: adaptador.provedor,
    ...(r.tipo === 'marcado'
      ? {
          status: 'marcada' as const,
          inicio: r.inicio,
          fim: r.fim,
          responsavel: r.responsavel,
          confirmadaEm: new Date(),
          ...(r.link ? { linkEvento: r.link } : {}),
          ...(r.conferencia ? { conferencia: r.conferencia } : {}),
        }
      : { status: 'oferecida' as const, linkAgendamento: r.url }),
  })

  return { ...r, provedor: adaptador.provedor }
}

/** Confirma (ou cancela) uma reunião a partir do webhook do fornecedor.
 *
 *  O casamento é pelo e-mail do convidado com o lead mais recente do cliente que
 *  recebeu uma oferta em aberto. É o que o fornecedor nos dá: o Calendly não
 *  sabe nada do nosso lead, só de quem preencheu o formulário dele. */
export async function confirmarReuniao(
  db: Db,
  c: ReuniaoConfirmada,
): Promise<{ ok: boolean; leadId?: string; motivo?: string }> {
  // Cancelamento de algo que já conhecemos: casa pelo id externo.
  if (c.cancelada && c.externoId) {
    const [existente] = await db
      .select()
      .from(reuniao)
      .where(and(eq(reuniao.provedor, c.provedor), eq(reuniao.externoId, c.externoId)))
      .limit(1)
    if (existente) {
      await db
        .update(reuniao)
        .set({
          status: 'cancelada',
          ...(c.motivoCancelamento ? { motivoCancelamento: c.motivoCancelamento } : {}),
        })
        .where(eq(reuniao.id, existente.id))
      return { ok: true, leadId: existente.leadId }
    }
  }

  const [oferta] = await db
    .select({ r: reuniao, l: lead })
    .from(reuniao)
    .innerJoin(lead, eq(lead.id, reuniao.leadId))
    .where(and(eq(reuniao.provedor, c.provedor), eq(reuniao.status, 'oferecida')))
    .orderBy(desc(reuniao.criadoEm))
    .limit(50)
    .then((linhas) => linhas.filter((x) => x.l.email === c.emailDoConvidado))

  if (!oferta) {
    // Alguém marcou pelo link público do cliente, fora de um fluxo nosso. Não é
    // erro; só não há lead a que amarrar.
    return { ok: false, motivo: 'nenhuma oferta em aberto para este e-mail' }
  }

  await db
    .update(reuniao)
    .set({
      status: c.cancelada ? 'cancelada' : 'marcada',
      externoId: c.externoId,
      inicio: c.inicio,
      ...(c.fim ? { fim: c.fim } : {}),
      confirmadaEm: new Date(),
      ...(c.motivoCancelamento ? { motivoCancelamento: c.motivoCancelamento } : {}),
    })
    .where(eq(reuniao.id, oferta.r.id))

  return { ok: true, leadId: oferta.r.leadId }
}

export async function reunioesDoLead(db: Db, leadId: string) {
  return db.select().from(reuniao).where(eq(reuniao.leadId, leadId)).orderBy(desc(reuniao.criadoEm))
}
