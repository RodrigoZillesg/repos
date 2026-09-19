import { and, eq } from 'drizzle-orm'
import { integracao, type Db } from '@avexa/db'
import { assinar, cifrar, conferirAssinatura, decifrar } from './cripto.ts'

/** Guarda de credenciais OAuth, comum a todos os fornecedores.
 *
 *  O refresh token fica cifrado na coluna `segredo`, amarrado ao cliente e ao
 *  tipo. O access token vive na config, em claro de propósito: ele expira em
 *  minutos, e cifrar o que já é efêmero só complicaria a renovação.
 *
 *  Genérico porque a dança é a mesma em qualquer fornecedor, e duplicá-la por
 *  integração é como se acumulam diferenças sutis — uma delas guardando o token
 *  errado, outra não desligando quando o acesso é revogado. */

export type TipoOAuth = 'google_calendar' | 'google_sheets' | 'calendly'

export interface CredenciaisOAuth {
  accessToken: string
  refreshToken?: string | undefined
  expiraEm: Date
  /** O que o fornecedor devolveu e precisa ir para a config: URI do usuário no
   *  Calendly, escopos concedidos pelo Google. Campo explícito em vez de índice
   *  aberto — um índice aberto estraga o estreitamento por `in` e faz o caminho
   *  de erro passar em silêncio pelo de sucesso. */
  extra?: Record<string, unknown> | undefined
}

export interface ConfigIntegracao {
  accessToken?: string
  expiraEm?: string
  conta?: string
  [chave: string]: unknown
}

const contexto = (clienteId: string, tipo: TipoOAuth) => `${clienteId}:${tipo}`

const NOME: Record<TipoOAuth, string> = {
  google_calendar: 'Google Calendar',
  google_sheets: 'Google Sheets',
  calendly: 'Calendly',
}

export async function salvarCredenciais(
  db: Db,
  clienteId: string,
  tipo: TipoOAuth,
  cred: CredenciaisOAuth,
  extra: Partial<ConfigIntegracao> = {},
): Promise<void> {
  const [existente] = await db
    .select()
    .from(integracao)
    .where(and(eq(integracao.clienteId, clienteId), eq(integracao.tipo, tipo)))
    .limit(1)

  const config: ConfigIntegracao = {
    ...((existente?.config as ConfigIntegracao) ?? {}),
    ...(cred.extra ?? {}),
    ...extra,
    accessToken: cred.accessToken,
    expiraEm: cred.expiraEm.toISOString(),
  }

  // Só sobrescreve o refresh token quando veio um novo. A renovação costuma
  // devolver o antigo, mas uma resposta sem ele não pode apagar o que temos.
  const segredo = cred.refreshToken
    ? cifrar(cred.refreshToken, contexto(clienteId, tipo))
    : (existente?.segredo ?? null)

  if (existente) {
    await db
      .update(integracao)
      .set({ config, segredo, ativo: true })
      .where(eq(integracao.id, existente.id))
  } else {
    await db
      .insert(integracao)
      .values({ clienteId, tipo, nome: NOME[tipo], config, segredo, ativo: true })
  }
}

export interface Conexao {
  accessToken: string
  config: ConfigIntegracao
  integracaoId: string
}

export type FalhaConexao = { erro: string; precisaReconectar?: boolean }

/** Renovação específica de cada fornecedor, injetada por quem chama.
 *  Resultado etiquetado, para o caminho de erro não se confundir com o de
 *  sucesso na hora de estreitar o tipo. */
export type ResultadoRenovacao =
  | { ok: true; cred: CredenciaisOAuth }
  | { ok: false; erro: string; revogado?: boolean }

export type Renovador = (refreshToken: string) => Promise<ResultadoRenovacao>

/** Devolve um access token válido, renovando se preciso.
 *
 *  Acesso revogado desliga a integração em vez de tentar de novo a cada lead:
 *  renovar um token revogado nunca funciona, e insistir só enche o log e gasta
 *  cota do fornecedor. */
export async function conexaoValida(
  db: Db,
  clienteId: string,
  tipo: TipoOAuth,
  renovar: Renovador,
): Promise<Conexao | FalhaConexao> {
  const [linha] = await db
    .select()
    .from(integracao)
    .where(
      and(eq(integracao.clienteId, clienteId), eq(integracao.tipo, tipo), eq(integracao.ativo, true)),
    )
    .limit(1)
  if (!linha) return { erro: 'integração não conectada', precisaReconectar: true }

  const config = (linha.config as ConfigIntegracao) ?? {}
  const expira = config.expiraEm ? new Date(config.expiraEm) : new Date(0)
  if (config.accessToken && expira > new Date()) {
    return { accessToken: config.accessToken, config, integracaoId: linha.id }
  }

  const refresh = decifrar(linha.segredo, contexto(clienteId, tipo))
  if (!refresh) {
    await db.update(integracao).set({ ativo: false }).where(eq(integracao.id, linha.id))
    return { erro: 'segredo ilegível — reconecte a conta', precisaReconectar: true }
  }

  const renovada = await renovar(refresh)
  if (!renovada.ok) {
    if (renovada.revogado) {
      await db.update(integracao).set({ ativo: false }).where(eq(integracao.id, linha.id))
      return { erro: 'o cliente revogou o acesso — reconecte a conta', precisaReconectar: true }
    }
    return { erro: renovada.erro }
  }

  await salvarCredenciais(db, clienteId, tipo, renovada.cred)
  const [atualizada] = await db
    .select()
    .from(integracao)
    .where(eq(integracao.id, linha.id))
    .limit(1)

  return {
    accessToken: renovada.cred.accessToken,
    config: (atualizada?.config as ConfigIntegracao) ?? config,
    integracaoId: linha.id,
  }
}

export async function lerConexao(
  db: Db,
  clienteId: string,
  tipo: TipoOAuth,
): Promise<{ ativo: boolean; config: ConfigIntegracao; segredo: string | null } | null> {
  const [linha] = await db
    .select()
    .from(integracao)
    .where(and(eq(integracao.clienteId, clienteId), eq(integracao.tipo, tipo)))
    .limit(1)
  if (!linha) return null
  return {
    ativo: linha.ativo,
    config: (linha.config as ConfigIntegracao) ?? {},
    segredo: linha.segredo,
  }
}

export function refreshTokenDe(
  clienteId: string,
  tipo: TipoOAuth,
  segredo: string | null,
): string | null {
  return decifrar(segredo, contexto(clienteId, tipo))
}

export async function definirDestino(
  db: Db,
  clienteId: string,
  tipo: TipoOAuth,
  extra: Partial<ConfigIntegracao>,
): Promise<void> {
  const [linha] = await db
    .select()
    .from(integracao)
    .where(and(eq(integracao.clienteId, clienteId), eq(integracao.tipo, tipo)))
    .limit(1)
  if (!linha) return
  await db
    .update(integracao)
    .set({ config: { ...((linha.config as ConfigIntegracao) ?? {}), ...extra } })
    .where(eq(integracao.id, linha.id))
}

export async function removerIntegracao(db: Db, clienteId: string, tipo: TipoOAuth): Promise<void> {
  await db
    .delete(integracao)
    .where(and(eq(integracao.clienteId, clienteId), eq(integracao.tipo, tipo)))
}

/** `state` assinado do OAuth: diz a qual cliente e a qual integração o retorno
 *  pertence. Sem assinatura, qualquer um poderia induzir o retorno a conectar a
 *  própria conta ao cliente de outra pessoa. */
export function montarState(clienteId: string, tipo: TipoOAuth): string {
  return assinar(JSON.stringify({ clienteId, tipo, em: Date.now() }))
}

const TIPOS: readonly TipoOAuth[] = ['google_calendar', 'google_sheets', 'calendly']

export function lerState(state: string | null): { clienteId: string; tipo: TipoOAuth } | null {
  const valor = conferirAssinatura(state)
  if (!valor) return null
  try {
    const o = JSON.parse(valor) as { clienteId?: string; tipo?: string; em?: number }
    if (!o.clienteId || !TIPOS.includes(o.tipo as TipoOAuth)) return null
    // Dez minutos: o consentimento é uma conversa curta, e um state velho
    // reaproveitado é um replay.
    if (!o.em || Date.now() - o.em > 10 * 60_000) return null
    return { clienteId: o.clienteId, tipo: o.tipo as TipoOAuth }
  } catch {
    return null
  }
}
