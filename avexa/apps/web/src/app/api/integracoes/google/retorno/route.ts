import { NextResponse } from 'next/server'
import { db } from '@avexa/db'
import { concluirConexao, lerState } from '@avexa/servicos'
import { sessaoAtual } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Retorno do consentimento do Google.
 *
 *  Duas checagens independentes: a sessão precisa ser de administrador (quem
 *  voltou é quem saiu) e o `state` precisa estar assinado por nós. Só a sessão
 *  não bastaria — alguém poderia induzir um admin logado a abrir esta URL com um
 *  código próprio e conectar a conta errada ao cliente errado. */
export async function GET(req: Request) {
  const url = new URL(req.url)
  const base = url.origin
  const volta = (q: string) => NextResponse.redirect(`${base}/integracoes?${q}`)

  const erroGoogle = url.searchParams.get('error')
  if (erroGoogle) return volta(`erro=${encodeURIComponent(erroGoogle)}`)

  const s = await sessaoAtual()
  if (!s?.permissoes.administrar) return volta('erro=sem-permissao')

  const estado = lerState(url.searchParams.get('state'))
  if (!estado) return volta('erro=state-invalido')

  const codigo = url.searchParams.get('code')
  if (!codigo) return volta('erro=sem-codigo')

  const r = await concluirConexao(db(), estado.clienteId, estado.tipo, codigo)
  return volta(
    r.ok ? `conectado=${estado.tipo}` : `erro=${encodeURIComponent(r.erro ?? 'falhou')}`,
  )
}
