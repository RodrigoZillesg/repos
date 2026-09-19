import { NextResponse } from 'next/server'
import { consumirToken } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Troca o token do e-mail por uma sessão e manda para o painel.
 *
 *  É um GET porque quem clica é o cliente de e-mail. Por isso o token é de uso
 *  único e de vida curta: pré-visualizadores de link abrem a URL sozinhos, e um
 *  token que sobrevivesse a isso já teria sido gasto por um robô. */
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get('t')
  const base = new URL(req.url).origin

  if (!token || !(await consumirToken(token))) {
    return NextResponse.redirect(`${base}/entrar?erro=1`)
  }
  return NextResponse.redirect(base)
}
