import { createHash, randomBytes } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { db, tokenAcesso, usuario } from '@avexa/db'

/** Emissão do link mágico de entrada.
 *
 *  Vive aqui, e não no painel, porque a operação também precisa emitir o link
 *  fora do navegador: na produção quem roda scripts é a imagem do worker, que
 *  não instala as dependências do Next. Painel e worker chamam a mesma função,
 *  então o formato do token e a validade não podem divergir entre os dois. */

export const VALIDADE_LINK_MIN = 15

export const hashDeToken = (v: string) => createHash('sha256').update(v).digest('hex')

export interface LinkDeAcesso {
  link: string
  usuarioId: string
  nome: string
  email: string
  idioma: 'pt-BR' | 'en'
}

/** Cria um token de uso único e devolve o link pronto.
 *
 *  Devolve `null` para e-mail desconhecido ou usuário inativo — quem chama
 *  decide se conta isso a alguém. No painel não conta: dizer "esse e-mail não
 *  existe" entrega ao mundo quem tem acesso. */
export async function emitirLinkDeAcesso(
  email: string,
  baseUrl: string,
): Promise<LinkDeAcesso | null> {
  const d = db()
  const limpo = email.trim().toLowerCase()

  const [u] = await d.select().from(usuario).where(eq(usuario.email, limpo)).limit(1)
  if (!u || !u.ativo) return null

  const bruto = randomBytes(32).toString('base64url')
  await d.insert(tokenAcesso).values({
    usuarioId: u.id,
    tokenHash: hashDeToken(bruto),
    expiraEm: new Date(Date.now() + VALIDADE_LINK_MIN * 60_000),
  })

  return {
    link: `${baseUrl.replace(/\/+$/, '')}/entrar/confirmar?t=${bruto}`,
    usuarioId: u.id,
    nome: u.nome,
    email: limpo,
    idioma: u.idioma as 'pt-BR' | 'en',
  }
}
