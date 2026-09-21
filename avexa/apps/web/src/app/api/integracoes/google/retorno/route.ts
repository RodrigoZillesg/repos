import { NextResponse } from 'next/server'
import { basePublica } from '@/lib/url'
import { db } from '@avexa/db'
import { concluirConexaoGoogle, lerState } from '@avexa/servicos'
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
  const base = basePublica(req.headers, req.url)
  const volta = (q: string) => NextResponse.redirect(`${base}/integracoes?${q}`)

  const erroProvedor = url.searchParams.get('error')
  if (erroProvedor) return volta(`erro=${encodeURIComponent(erroProvedor)}`)

  const s = await sessaoAtual()
  if (!s?.permissoes.administrar) return volta('erro=sem-permissao')

  const estado = lerState(url.searchParams.get('state'))
  // Positivo, não por exclusão: listar o que esta rota aceita faz o compilador
  // apontar aqui quando entrar um fornecedor novo, em vez de deixar passar.
  if (estado?.tipo !== 'google_calendar' && estado?.tipo !== 'google_sheets') {
    return volta('erro=state-invalido')
  }

  const codigo = url.searchParams.get('code')
  if (!codigo) return volta('erro=sem-codigo')

  const r = await concluirConexaoGoogle(db(), estado.projetoId, estado.tipo, codigo)
  return volta(r.ok ? `conectado=${estado.tipo}` : `erro=${encodeURIComponent(r.erro ?? 'falhou')}`)
}
