import { NextResponse } from 'next/server'
import { db } from '@avexa/db'
import { ingerirLead } from '@avexa/servicos'
import { lerCorpo, resposta } from '../../comum'

/** Entrada de lead. É a única coisa técnica que entregamos ao cliente.
 *
 *  Duas formas de endereço, num arquivo só:
 *
 *      /v1/<cliente>/<fluxo>              a antiga, e ela não vai sumir
 *      /v1/<cliente>/<projeto>/<fluxo>    a nova
 *
 *  A antiga continua valendo porque está colada em formulários que não
 *  controlamos: trocá-la faria os leads pararem de chegar, e o sintoma seria
 *  silêncio. A nova existe porque duas frentes do mesmo cliente querem um fluxo
 *  "lead-novo" cada, e sem o projeto no caminho não há como distinguir.
 *
 *  É um catch-all e não duas rotas porque o Next não aceita dois nomes de
 *  parâmetro no mesmo segmento — e porque as duas formas são o mesmo contrato:
 *  separá-las em dois arquivos convidaria a corrigir uma e esquecer a outra. */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface Contexto {
  params: Promise<{ cliente: string; caminho: string[] }>
}

async function processar(ctx: Contexto, dados: Record<string, unknown>) {
  const { cliente, caminho } = await ctx.params

  // Um segmento é a forma antiga; dois, a nova. Qualquer outra coisa é um
  // endereço que nunca existiu.
  const [a, b] = caminho
  if (!a || caminho.length > 2) {
    return NextResponse.json({ aceito: false, motivo: 'endereco_invalido' }, { status: 404 })
  }

  return resposta(
    await ingerirLead(db(), {
      clienteSlug: cliente,
      ...(b ? { projetoSlug: a } : {}),
      fluxoSlug: b ?? a,
      dados,
    }),
  )
}

export async function POST(req: Request, ctx: Contexto) {
  return processar(ctx, await lerCorpo(req))
}

export async function GET(req: Request, ctx: Contexto) {
  return processar(ctx, Object.fromEntries(new URL(req.url).searchParams.entries()))
}
