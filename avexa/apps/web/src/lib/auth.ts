import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { cookies } from 'next/headers'
import { and, eq, gt, isNull } from 'drizzle-orm'
import { db, sessao, tokenAcesso, usuario } from '@avexa/db'
import { adaptadorResend, adaptadoresDoAmbiente } from '@avexa/adapters'
import { VALIDADE_LINK_MIN, emitirLinkDeAcesso } from '@avexa/servicos'
import { PERMISSOES, type Papel, type Permissoes } from './papeis'

/** Acesso por link mágico.
 *
 *  Ninguém tem senha — nem a equipe, nem o cliente. Resolve o convite do cliente
 *  final sem ele "criar conta", que é a promessa do produto, e tira do caminho
 *  todo o aparato de recuperação, rotação e vazamento de senha.
 *
 *  Guardamos apenas o hash do token; o valor em claro existe só no e-mail. Um
 *  dump do banco não dá acesso a ninguém. */

const COOKIE = 'avexa_sessao'
const VALIDADE_SESSAO_DIAS = 30

const hash = (v: string) => createHash('sha256').update(v).digest('hex')

export interface Sessao {
  usuarioId: string
  nome: string
  email: string
  papel: Papel
  clienteId: string | null
  idioma: 'pt-BR' | 'en'
  permissoes: Permissoes
}

/** Pede um link de acesso.
 *
 *  Devolve sucesso mesmo para e-mail desconhecido: dizer "esse e-mail não
 *  existe" entrega ao mundo quem tem acesso ao painel. */
export async function pedirLink(email: string, baseUrl: string): Promise<void> {
  await enviarLink(email, baseUrl, 'login')
}

/** O mesmo link, com o texto de quem está chegando agora.
 *
 *  "Seu link de acesso" para quem nunca ouviu falar da Avexa parece phishing —
 *  e um convite que vai para o lixo eletrônico é um cliente que liga
 *  perguntando por que não consegue entrar. */
export async function enviarConvite(
  email: string,
  baseUrl: string,
  convidadoPor: string,
): Promise<{ enviado: boolean; link: string | null }> {
  return enviarLink(email, baseUrl, 'convite', convidadoPor)
}

async function enviarLink(
  email: string,
  baseUrl: string,
  tipo: 'login' | 'convite',
  convidadoPor?: string,
): Promise<{ enviado: boolean; link: string | null }> {
  const emitido = await emitirLinkDeAcesso(email, baseUrl)
  if (!emitido) return { enviado: false, link: null }

  const { link, usuarioId, email: limpo, nome, idioma } = emitido
  const cfg = adaptadoresDoAmbiente().email
  const en = idioma === 'en'

  if (!cfg) {
    // Sem Resend configurado o link não sai daqui. Em desenvolvimento isso é o
    // esperado, e o log é o canal de entrega. No convite o link também volta a
    // quem convidou, para ele repassar — senão o usuário novo fica trancado
    // sem ninguém entender por quê.
    console.log(`[avexa] link de acesso para ${limpo}: ${link}`)
    return { enviado: false, link: tipo === 'convite' ? link : null }
  }

  const de = convidadoPor ? (en ? ` by ${convidadoPor}` : ` por ${convidadoPor}`) : ''
  const corpo =
    tipo === 'convite'
      ? en
        ? `Hi ${nome},\n\nYou have been given access to Avexa${de}.\n\nOpen this link to sign in. It expires in ${VALIDADE_LINK_MIN} minutes and works once — after that, ask for a new one at ${baseUrl}/entrar.\n\n${link}`
        : `Oi ${nome},\n\nVocê recebeu acesso ao Avexa${de}.\n\nAbra este link para entrar. Ele expira em ${VALIDADE_LINK_MIN} minutos e funciona uma vez só — depois disso, peça outro em ${baseUrl}/entrar.\n\n${link}`
      : en
        ? `Hi ${nome},\n\nOpen this link to sign in. It expires in ${VALIDADE_LINK_MIN} minutes and works once.\n\n${link}`
        : `Oi ${nome},\n\nAbra este link para entrar. Ele expira em ${VALIDADE_LINK_MIN} minutos e funciona uma vez só.\n\n${link}`

  const r = await adaptadorResend(cfg).enviar({
    tentativaId: `${tipo}-${usuarioId}`,
    canal: 'email',
    destinatario: limpo,
    assunto:
      tipo === 'convite'
        ? en
          ? 'You have been given access to Avexa'
          : 'Você recebeu acesso ao Avexa'
        : en
          ? 'Your Avexa sign-in link'
          : 'Seu link de acesso ao Avexa',
    texto: corpo,
  })

  // O envio pode falhar por domínio não verificado, cota, endereço recusado.
  // No convite isso não pode passar em silêncio: o admin acha que avisou o
  // cliente e ninguém recebeu nada.
  return { enviado: r.ok, link: r.ok ? null : tipo === 'convite' ? link : null }
}

/** Troca o token do e-mail por uma sessão. O token é queimado no uso. */
export async function consumirToken(bruto: string): Promise<boolean> {
  const d = db()
  const agora = new Date()

  const [t] = await d
    .select()
    .from(tokenAcesso)
    .where(
      and(
        eq(tokenAcesso.tokenHash, hash(bruto)),
        isNull(tokenAcesso.usadoEm),
        gt(tokenAcesso.expiraEm, agora),
      ),
    )
    .limit(1)
  if (!t) return false

  await d.update(tokenAcesso).set({ usadoEm: agora }).where(eq(tokenAcesso.id, t.id))

  const tokenSessao = randomBytes(32).toString('base64url')
  const expiraEm = new Date(Date.now() + VALIDADE_SESSAO_DIAS * 86_400_000)
  await d.insert(sessao).values({ usuarioId: t.usuarioId, tokenHash: hash(tokenSessao), expiraEm })
  await d.update(usuario).set({ ultimoAcessoEm: agora }).where(eq(usuario.id, t.usuarioId))

  const jar = await cookies()
  jar.set(COOKIE, tokenSessao, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: expiraEm,
  })
  return true
}

export async function sessaoAtual(): Promise<Sessao | null> {
  const jar = await cookies()
  const bruto = jar.get(COOKIE)?.value
  if (!bruto) return null

  const d = db()
  const [linha] = await d
    .select({ s: sessao, u: usuario })
    .from(sessao)
    .innerJoin(usuario, eq(usuario.id, sessao.usuarioId))
    .where(and(eq(sessao.tokenHash, hash(bruto)), gt(sessao.expiraEm, new Date())))
    .limit(1)

  if (!linha || !linha.u.ativo) return null

  const papel = linha.u.papel as Papel
  return {
    usuarioId: linha.u.id,
    nome: linha.u.nome,
    email: linha.u.email,
    papel,
    clienteId: linha.u.clienteId,
    idioma: linha.u.idioma as 'pt-BR' | 'en',
    permissoes: PERMISSOES[papel],
  }
}

export async function encerrarSessao(): Promise<void> {
  const jar = await cookies()
  const bruto = jar.get(COOKIE)?.value
  if (bruto) {
    await db().delete(sessao).where(eq(sessao.tokenHash, hash(bruto)))
  }
  jar.delete(COOKIE)
}

/** Compara segredos em tempo constante, para assinatura de webhook. */
export function comparaSegredo(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ba.length !== bb.length) return false
  return timingSafeEqual(ba, bb)
}
