import { NextResponse } from 'next/server'
import { db } from '@avexa/db'
import { ingerirLead } from '@avexa/servicos'

/** Entrada de lead. É a única coisa técnica que entregamos ao cliente.
 *
 *  Aceita JSON, form-urlencoded e query string, porque a URL é colada na saída
 *  de um formulário que não controlamos. Responde sempre 200 quando o corpo foi
 *  lido: um 4xx faria a plataforma do cliente marcar o webhook como quebrado e,
 *  em algumas delas, desativá-lo — e "lead duplicado" ou "lead velho" não é
 *  falha de integração, é decisão de negócio. O motivo vai no corpo da resposta
 *  e para o registro. */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface Contexto {
  params: Promise<{ cliente: string; fluxo: string }>
}

async function lerCorpo(req: Request): Promise<Record<string, unknown>> {
  const tipo = req.headers.get('content-type') ?? ''

  if (tipo.includes('application/json')) {
    try {
      const v = await req.json()
      return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {}
    } catch {
      return {}
    }
  }

  if (tipo.includes('form')) {
    const f = await req.formData()
    return Object.fromEntries([...f.entries()].map(([k, v]) => [k, String(v)]))
  }

  // Corpo sem tipo declarado: tenta JSON, cai para texto cru num campo só.
  const texto = await req.text()
  if (!texto) return {}
  try {
    return JSON.parse(texto) as Record<string, unknown>
  } catch {
    return { corpo: texto }
  }
}

async function processar(req: Request, ctx: Contexto, dados: Record<string, unknown>) {
  const { cliente, fluxo } = await ctx.params

  const r = await ingerirLead(db(), { clienteSlug: cliente, fluxoSlug: fluxo, dados })

  if (!r.aceito) {
    // 404 só quando o endereço realmente não existe; o resto é 200 com motivo.
    const status = r.motivo === 'cliente_inativo' || r.motivo === 'fluxo_nao_publicado' ? 404 : 200
    return NextResponse.json({ aceito: false, motivo: r.motivo }, { status })
  }

  return NextResponse.json({ aceito: true, leadId: r.leadId })
}

export async function POST(req: Request, ctx: Contexto) {
  return processar(req, ctx, await lerCorpo(req))
}

export async function GET(req: Request, ctx: Contexto) {
  const query = Object.fromEntries(new URL(req.url).searchParams.entries())
  return processar(req, ctx, query)
}
