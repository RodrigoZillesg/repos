import { NextResponse } from 'next/server'
import {
  urlParaConectarCalendly,
  urlParaConectarGoogle,
  urlParaConectarHubspot,
  type TipoGoogle,
} from '@avexa/servicos'
import { sessaoAtual } from '@/lib/auth'
import { basePublica } from '@/lib/url'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Manda o operador para a tela de consentimento do fornecedor escolhido.
 *
 *  Conectar a conta de um cliente dá à Avexa acesso contínuo à agenda, às
 *  planilhas ou ao CRM dele, então só administrador faz isso — e a checagem é aqui, no
 *  servidor, antes de qualquer redirecionamento. */
export async function GET(req: Request) {
  const s = await sessaoAtual()
  const base = basePublica(req.headers, req.url)
  const volta = (q: string) => NextResponse.redirect(`${base}/integracoes?${q}`)

  if (!s?.permissoes.administrar) return volta('erro=sem-permissao')

  const url = new URL(req.url)
  // A conexão é do projeto: cada frente marca na agenda e grava no CRM do
  // time dela.
  const projetoId = url.searchParams.get('projeto')
  const tipo = url.searchParams.get('tipo')
  if (!projetoId) return volta('erro=pedido-invalido')

  const destino =
    tipo === 'calendly'
      ? urlParaConectarCalendly(projetoId)
      : tipo === 'hubspot'
        ? urlParaConectarHubspot(projetoId)
        : tipo === 'google_calendar' || tipo === 'google_sheets'
          ? urlParaConectarGoogle(projetoId, tipo as TipoGoogle)
          : null

  if (!destino) return volta('erro=fornecedor-nao-configurado')
  return NextResponse.redirect(destino)
}
