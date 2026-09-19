import { NextResponse } from 'next/server'
import { db } from '@avexa/db'
import { concluirConexaoCalendly, lerState } from '@avexa/servicos'
import { sessaoAtual } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Retorno do consentimento do Calendly. Mesmas duas checagens do Google. */
export async function GET(req: Request) {
  const url = new URL(req.url)
  const base = url.origin
  const volta = (q: string) => NextResponse.redirect(`${base}/integracoes?${q}`)

  const erroProvedor = url.searchParams.get('error')
  if (erroProvedor) return volta(`erro=${encodeURIComponent(erroProvedor)}`)

  const s = await sessaoAtual()
  if (!s?.permissoes.administrar) return volta('erro=sem-permissao')

  const estado = lerState(url.searchParams.get('state'))
  if (estado?.tipo !== 'calendly') return volta('erro=state-invalido')

  const codigo = url.searchParams.get('code')
  if (!codigo) return volta('erro=sem-codigo')

  const r = await concluirConexaoCalendly(db(), estado.clienteId, codigo)
  return volta(r.ok ? 'conectado=calendly' : `erro=${encodeURIComponent(r.erro ?? 'falhou')}`)
}
