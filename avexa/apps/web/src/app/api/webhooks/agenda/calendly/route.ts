import { NextResponse } from 'next/server'
import { db } from '@avexa/db'
import { conferirAssinaturaCalendly, interpretarWebhookCalendly } from '@avexa/adapters'
import { confirmarReuniao } from '@avexa/servicos'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Confirmação de reunião vinda do Calendly.
 *
 *  Com Calendly quem marca é o lead, então é por aqui que a reunião deixa de ser
 *  uma oferta e passa a existir. A assinatura é conferida sobre o corpo **cru**:
 *  reserializar o JSON muda espaço e ordem de chave, e a assinatura deixa de
 *  bater. Sem chave de assinatura configurada a rota recusa tudo — um webhook
 *  aberto deixaria qualquer um inventar reuniões no painel do cliente. */
export async function POST(req: Request) {
  const chave = process.env.CALENDLY_SIGNING_KEY
  if (!chave) return NextResponse.json({ erro: 'webhook não configurado' }, { status: 503 })

  const cru = await req.text()
  const assinatura = req.headers.get('calendly-webhook-signature')
  if (!conferirAssinaturaCalendly(assinatura, cru, chave)) {
    return NextResponse.json({ erro: 'assinatura inválida' }, { status: 401 })
  }

  let corpo: unknown
  try {
    corpo = JSON.parse(cru)
  } catch {
    return NextResponse.json({ erro: 'corpo inválido' }, { status: 400 })
  }

  const confirmacao = interpretarWebhookCalendly(corpo)
  if (!confirmacao) return NextResponse.json({ ok: true, ignorado: true })

  const r = await confirmarReuniao(db(), confirmacao)
  // 200 mesmo quando não casou com lead nenhum: alguém pode ter marcado pelo
  // link público do cliente, fora de um fluxo nosso, e devolver erro faria o
  // Calendly reenviar para sempre.
  return NextResponse.json({ ok: true, casou: r.ok, ...(r.motivo ? { motivo: r.motivo } : {}) })
}
