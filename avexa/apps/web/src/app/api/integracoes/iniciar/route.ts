import { NextResponse } from 'next/server'
import { urlParaConectarCalendly, urlParaConectarGoogle, type TipoGoogle } from '@avexa/servicos'
import { sessaoAtual } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Manda o operador para a tela de consentimento do fornecedor escolhido.
 *
 *  Conectar a conta de um cliente dá à Avexa acesso contínuo à agenda ou às
 *  planilhas dele, então só administrador faz isso — e a checagem é aqui, no
 *  servidor, antes de qualquer redirecionamento. */
export async function GET(req: Request) {
  const s = await sessaoAtual()
  const base = new URL(req.url).origin
  const volta = (q: string) => NextResponse.redirect(`${base}/integracoes?${q}`)

  if (!s?.permissoes.administrar) return volta('erro=sem-permissao')

  const url = new URL(req.url)
  const clienteId = url.searchParams.get('cliente')
  const tipo = url.searchParams.get('tipo')
  if (!clienteId) return volta('erro=pedido-invalido')

  const destino =
    tipo === 'calendly'
      ? urlParaConectarCalendly(clienteId)
      : tipo === 'google_calendar' || tipo === 'google_sheets'
        ? urlParaConectarGoogle(clienteId, tipo as TipoGoogle)
        : null

  if (!destino) return volta('erro=fornecedor-nao-configurado')
  return NextResponse.redirect(destino)
}
