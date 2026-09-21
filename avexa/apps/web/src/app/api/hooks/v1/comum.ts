import { NextResponse } from 'next/server'
import type { ResultadoIngestao } from '@avexa/servicos'

/** O que as duas formas da URL de entrada têm em comum.
 *
 *  Existe para que a forma antiga (cliente/fluxo) e a nova
 *  (cliente/projeto/fluxo) não divirjam: elas são o mesmo contrato, e um
 *  ajuste feito só numa delas seria descoberto por um cliente cujo formulário
 *  ainda usa a outra. */

/** Aceita JSON, form-urlencoded e query string, porque a URL é colada na saída
 *  de um formulário que não controlamos. */
export async function lerCorpo(req: Request): Promise<Record<string, unknown>> {
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

/** Responde sempre 200 quando o corpo foi lido: um 4xx faria a plataforma do
 *  cliente marcar o webhook como quebrado e, em algumas delas, desativá-lo — e
 *  "lead duplicado" ou "lead velho" não é falha de integração, é decisão de
 *  negócio. O motivo vai no corpo e para o registro.
 *
 *  As exceções são endereços que realmente não resolvem: cliente inativo, fluxo
 *  não publicado, e o fluxo ambíguo — este último é um endereço de duas partes
 *  num cliente onde duas frentes têm um fluxo de mesmo nome. Aceitar e escolher
 *  uma delas mandaria o lead ser contatado pelo telefone da frente errada, sem
 *  erro nenhum aparecer. */
export function resposta(r: ResultadoIngestao) {
  if (r.aceito) return NextResponse.json({ aceito: true, leadId: r.leadId })

  const status =
    r.motivo === 'cliente_inativo' || r.motivo === 'fluxo_nao_publicado'
      ? 404
      : r.motivo === 'fluxo_ambiguo'
        ? 409
        : 200

  return NextResponse.json(
    {
      aceito: false,
      motivo: r.motivo,
      ...(r.motivo === 'fluxo_ambiguo'
        ? {
            detalhe:
              'Dois projetos deste cliente têm um fluxo com este nome. Use a URL com o projeto: /v1/<cliente>/<projeto>/<fluxo>.',
          }
        : {}),
    },
    { status },
  )
}
