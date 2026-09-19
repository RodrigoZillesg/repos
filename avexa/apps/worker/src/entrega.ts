import { and, eq } from 'drizzle-orm'
import { requisitar, adaptadorResend } from '@avexa/adapters'
import { integracao as tIntegracao, lead as tLead } from '@avexa/db'
import { registrarNaPlanilha } from '@avexa/servicos'
import type { Ambiente } from './contexto.ts'

/** Entrega do lead qualificado onde o cliente trabalha.
 *
 *  Os quatro destinos do construtor. Em modo seco nada sai: o destino é
 *  resolvido e registrado, mas a chamada não acontece. */

export interface PedidoEntrega {
  leadId: string
  clienteId: string
  destino: string
  urgente: boolean
  seco: boolean
}

export async function entregarLead(amb: Ambiente, p: PedidoEntrega): Promise<void> {
  const [ld] = await amb.db.select().from(tLead).where(eq(tLead.id, p.leadId)).limit(1)
  if (!ld) return

  const carga = {
    lead: {
      id: ld.id,
      nome: ld.nome,
      telefone: ld.telefone,
      email: ld.email,
      score: ld.score,
      motivo: ld.scoreMotivo,
      resumo: ld.resumo,
      etiquetas: ld.etiquetas,
      campos: ld.campos,
      utm: ld.utm,
      criadoEm: ld.criadoEm,
    },
    urgente: p.urgente,
  }

  if (p.seco) return

  const tipo = (
    {
      'CRM do cliente': 'hubspot',
      'E-mail do time': 'email_time',
      'Planilha compartilhada': 'google_sheets',
      'Webhook do cliente': 'webhook',
    } as const
  )[p.destino]
  if (!tipo) return

  const [conf] = await amb.db
    .select()
    .from(tIntegracao)
    .where(
      and(
        eq(tIntegracao.clienteId, p.clienteId),
        eq(tIntegracao.tipo, tipo),
        eq(tIntegracao.ativo, true),
      ),
    )
    .limit(1)
  if (!conf) return

  const cfg = conf.config as Record<string, string>

  if (tipo === 'webhook' && cfg.url) {
    await requisitar(cfg.url, { corpo: carga, timeoutMs: 15_000 })
    return
  }

  if (tipo === 'email_time' && cfg.para && amb.adaptadores.email) {
    const resend = adaptadorResend(amb.adaptadores.email)
    await resend.enviar({
      tentativaId: `entrega-${ld.id}`,
      canal: 'email',
      destinatario: cfg.para,
      assunto: `${p.urgente ? '[URGENTE] ' : ''}Lead qualificado: ${ld.nome ?? ld.email ?? ld.telefone}`,
      texto: [
        `Score: ${ld.score ?? '—'} (${ld.scoreMotivo ?? 'sem motivo registrado'})`,
        `Resumo: ${ld.resumo ?? '—'}`,
        `Telefone: ${ld.telefone ?? '—'}`,
        `E-mail: ${ld.email ?? '—'}`,
      ].join('\n'),
    })
    return
  }

  if (tipo === 'hubspot' && conf.segredo) {
    await requisitar('https://api.hubapi.com/crm/v3/objects/contacts', {
      cabecalhos: { authorization: `Bearer ${conf.segredo}` },
      corpo: {
        properties: {
          email: ld.email ?? undefined,
          phone: ld.telefone ?? undefined,
          firstname: ld.nome ?? undefined,
          hs_lead_status: (ld.score ?? 0) >= 60 ? 'QUALIFIED' : 'OPEN',
          avexa_score: String(ld.score ?? ''),
          avexa_resumo: ld.resumo ?? '',
        },
      },
      timeoutMs: 15_000,
    })
    return
  }

  if (tipo === 'google_sheets') {
    const utm = (ld.utm ?? {}) as Record<string, string>
    await registrarNaPlanilha(amb.db, p.clienteId, [
      ld.criadoEm.toISOString(),
      ld.nome,
      ld.telefone,
      ld.email,
      ld.score,
      ld.scoreMotivo,
      ld.resumo,
      (ld.etiquetas ?? []).join(', '),
      utm.utm_source ?? null,
      utm.utm_campaign ?? null,
    ])
  }
}

export interface PedidoWebhookSaida {
  leadId: string
  url: string
  metodo: string
  payload: string
  cabecalhos: string
  tentativas: number
  seco: boolean
}

/** Webhook de saída no meio do fluxo, com reenvio.
 *
 *  O reenvio é imediato e curto, não a fila: este passo bloqueia o fluxo, e
 *  jogá-lo para a fila exigiria dividir a execução em duas. Falha definitiva não
 *  derruba o fluxo — o lead continua o percurso. */
export async function dispararWebhookSaida(amb: Ambiente, p: PedidoWebhookSaida): Promise<void> {
  if (p.seco || !p.url) return

  const [ld] = await amb.db.select().from(tLead).where(eq(tLead.id, p.leadId)).limit(1)
  if (!ld) return

  const corpo =
    p.payload === 'Lead e score'
      ? { id: ld.id, nome: ld.nome, telefone: ld.telefone, email: ld.email, score: ld.score }
      : p.payload === 'Só o resultado do contato'
        ? { id: ld.id, score: ld.score, resumo: ld.resumo }
        : { ...(ld.campos as Record<string, unknown>), utm: ld.utm, id: ld.id, score: ld.score }

  let cabecalhos: Record<string, string> = {}
  for (const linha of p.cabecalhos.split('\n')) {
    const i = linha.indexOf(':')
    if (i > 0) cabecalhos[linha.slice(0, i).trim()] = linha.slice(i + 1).trim()
  }

  for (let n = 0; n < Math.max(1, p.tentativas); n++) {
    const r = await requisitar(p.url, { metodo: p.metodo, cabecalhos, corpo, timeoutMs: 15_000 })
    if (r.ok || !r.reenviavel) return
    await new Promise((ok) => setTimeout(ok, 2 ** n * 1000))
  }
}
