import { NextResponse } from 'next/server'
import type { Canal } from '@avexa/core'
import { fila, FILAS } from '@avexa/servicos'
import { conferirAssinaturaTwilio } from '@avexa/adapters'
import { basePublica } from '@/lib/url'

/** Retorno dos fornecedores: entrega, leitura, resposta, bounce, opt-out, fim de
 *  chamada.
 *
 *  A rota não interpreta nada — enfileira o corpo cru e responde na hora. Um
 *  fornecedor que espera mais de poucos segundos desativa o webhook, e
 *  interpretar aqui significaria fazer trabalho de banco dentro do prazo dele.
 *  Quem traduz é o adaptador, no worker. */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const CANAIS = new Set<string>(['email', 'sms', 'whatsapp', 'ligacao'])

/** Meta exige responder ao desafio de verificação na assinatura do webhook. */
export async function GET(req: Request, ctx: { params: Promise<{ canal: string }> }) {
  const { canal } = await ctx.params
  const url = new URL(req.url)

  if (canal === 'whatsapp') {
    const modo = url.searchParams.get('hub.mode')
    const token = url.searchParams.get('hub.verify_token')
    const desafio = url.searchParams.get('hub.challenge')
    if (modo === 'subscribe' && token && token === process.env.WHATSAPP_VERIFY_TOKEN) {
      return new NextResponse(desafio ?? '', { status: 200 })
    }
    return new NextResponse('token inválido', { status: 403 })
  }

  return NextResponse.json({ ok: true })
}

export async function POST(req: Request, ctx: { params: Promise<{ canal: string }> }) {
  const { canal } = await ctx.params
  if (!CANAIS.has(canal)) return NextResponse.json({ erro: 'canal desconhecido' }, { status: 404 })

  const tipo = req.headers.get('content-type') ?? ''
  let corpo: unknown

  if (tipo.includes('form')) {
    // O Twilio manda form-urlencoded.
    const f = await req.formData()
    corpo = Object.fromEntries([...f.entries()].map(([k, v]) => [k, String(v)]))
  } else {
    try {
      corpo = await req.json()
    } catch {
      corpo = {}
    }
  }

  // O SMS é Twilio, e o Twilio assina. Sem conferir, esta rota aceitaria de
  // qualquer um um `Body=STOP&From=<numero>` — o que põe o número de um lead
  // real na supressão GLOBAL e cala o contato com ele para sempre. Também dá
  // para forjar "o lead respondeu" e fazer o motor abandonar a sequência.
  //
  // A URL assinada é a pública: atrás do nginx, a que o Next monta é
  // http://0.0.0.0:3000 e nenhuma assinatura bateria.
  if (canal === 'sms') {
    const token = process.env.TWILIO_AUTH_TOKEN
    const alvo = new URL(req.url)
    const urlPublica = `${basePublica(req.headers, req.url)}${alvo.pathname}${alvo.search}`
    const valida =
      !!token &&
      typeof corpo === 'object' &&
      corpo !== null &&
      conferirAssinaturaTwilio(
        token,
        urlPublica,
        corpo as Record<string, string>,
        req.headers.get('x-twilio-signature'),
      )

    if (!valida) {
      // Sem detalhe na resposta: dizer "assinatura inválida" contra "canal
      // desconhecido" ajuda quem está sondando.
      return NextResponse.json({ erro: 'nao autorizado' }, { status: 403 })
    }
  }

  const cabecalhos: Record<string, string> = {}
  req.headers.forEach((v, k) => {
    cabecalhos[k] = v
  })

  const b = await fila()
  await b.send(FILAS.evento, { canal: canal as Canal, corpo, cabecalhos }, { retryLimit: 3, retryBackoff: true })

  return NextResponse.json({ ok: true })
}
