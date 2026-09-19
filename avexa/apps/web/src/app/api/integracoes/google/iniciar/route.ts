import { NextResponse } from 'next/server'
import { urlParaConectar, type TipoGoogle } from '@avexa/servicos'
import { sessaoAtual } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Manda o operador para a tela de consentimento do Google.
 *
 *  Conectar a conta Google de um cliente dá à Avexa acesso contínuo à agenda e
 *  às planilhas dele, então só administrador faz isso — e a checagem é aqui, no
 *  servidor, antes de qualquer redirecionamento. */
export async function GET(req: Request) {
  const s = await sessaoAtual()
  const base = new URL(req.url).origin
  if (!s?.permissoes.administrar) {
    return NextResponse.redirect(`${base}/integracoes?erro=sem-permissao`)
  }

  const url = new URL(req.url)
  const clienteId = url.searchParams.get('cliente')
  const tipo = url.searchParams.get('tipo') as TipoGoogle | null

  if (!clienteId || (tipo !== 'google_calendar' && tipo !== 'google_sheets')) {
    return NextResponse.redirect(`${base}/integracoes?erro=pedido-invalido`)
  }

  const consentimento = urlParaConectar(clienteId, tipo)
  if (!consentimento) {
    return NextResponse.redirect(`${base}/integracoes?erro=google-nao-configurado`)
  }
  return NextResponse.redirect(consentimento)
}
