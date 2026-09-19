import { NextResponse } from 'next/server'
import { db } from '@avexa/db'
import { concluirConexaoHubspot, lerState } from '@avexa/servicos'
import { sessaoAtual } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Retorno do consentimento do HubSpot.
 *
 *  Conectar aqui faz mais do que guardar token: cria as propriedades da Avexa
 *  no portal e lê as opções de status de lead que aquele portal usa. O que não
 *  der para preparar volta como aviso na tela, não como falha — o cliente está
 *  conectado, e o operador precisa saber o que ficou pela metade. */
export async function GET(req: Request) {
  const url = new URL(req.url)
  const base = url.origin
  const volta = (q: string) => NextResponse.redirect(`${base}/integracoes?${q}`)

  const erroProvedor = url.searchParams.get('error')
  if (erroProvedor) return volta(`erro=${encodeURIComponent(erroProvedor)}`)

  const s = await sessaoAtual()
  if (!s?.permissoes.administrar) return volta('erro=sem-permissao')

  const estado = lerState(url.searchParams.get('state'))
  if (estado?.tipo !== 'hubspot') return volta('erro=state-invalido')

  const codigo = url.searchParams.get('code')
  if (!codigo) return volta('erro=sem-codigo')

  const r = await concluirConexaoHubspot(db(), estado.clienteId, codigo)
  if (!r.ok) return volta(`erro=${encodeURIComponent(r.erro ?? 'falhou')}`)
  return volta(
    r.avisos?.length
      ? `conectado=hubspot&aviso=${encodeURIComponent(r.avisos.join(' '))}`
      : 'conectado=hubspot',
  )
}
