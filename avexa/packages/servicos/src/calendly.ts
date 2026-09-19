import type { Db } from '@avexa/db'
import {
  configCalendlyDoAmbiente,
  renovarCalendly,
  tiposDeEvento,
  trocarCodigoCalendly,
  urlDeConsentimentoCalendly,
  type TipoDeEvento,
} from '@avexa/adapters'
import {
  conexaoValida,
  montarState,
  removerIntegracao,
  salvarCredenciais,
  type Conexao,
  type FalhaConexao,
} from './oauth.ts'

/** Calendly por cliente. */

export function calendlyConfigurado(): boolean {
  return configCalendlyDoAmbiente() !== null && (process.env.APP_SECRET ?? '').length >= 32
}

export function urlParaConectarCalendly(clienteId: string): string | null {
  const cfg = configCalendlyDoAmbiente()
  if (!cfg || !calendlyConfigurado()) return null
  return urlDeConsentimentoCalendly(cfg, montarState(clienteId, 'calendly'))
}

export async function concluirConexaoCalendly(
  db: Db,
  clienteId: string,
  codigo: string,
): Promise<{ ok: boolean; erro?: string }> {
  const cfg = configCalendlyDoAmbiente()
  if (!cfg) return { ok: false, erro: 'Calendly não configurado neste ambiente' }

  const cred = await trocarCodigoCalendly(cfg, codigo)
  if ('erro' in cred) return { ok: false, erro: cred.erro }
  if (!cred.refreshToken) {
    return { ok: false, erro: 'O Calendly não devolveu um token de longa duração.' }
  }

  await salvarCredenciais(db, clienteId, 'calendly', {
    accessToken: cred.accessToken,
    refreshToken: cred.refreshToken,
    expiraEm: cred.expiraEm,
    extra: { usuario: cred.usuario ?? null, organizacao: cred.organizacao ?? null },
  })
  return { ok: true }
}

export async function conexaoCalendly(db: Db, clienteId: string): Promise<Conexao | FalhaConexao> {
  const cfg = configCalendlyDoAmbiente()
  if (!cfg) return { erro: 'Calendly não configurado neste ambiente' }
  return conexaoValida(db, clienteId, 'calendly', async (refresh) => {
    const r = await renovarCalendly(cfg, refresh)
    if ('erro' in r) return { ok: false, erro: r.erro, ...(r.revogado ? { revogado: true } : {}) }
    return {
      ok: true,
      cred: {
        accessToken: r.accessToken,
        refreshToken: r.refreshToken,
        expiraEm: r.expiraEm,
        extra: { usuario: r.usuario ?? null, organizacao: r.organizacao ?? null },
      },
    }
  })
}

export async function desconectarCalendly(db: Db, clienteId: string): Promise<void> {
  // O Calendly não expõe endpoint de revogação de token; o cliente remove o
  // acesso em Integrations na conta dele. Apagamos o que temos de qualquer jeito.
  await removerIntegracao(db, clienteId, 'calendly')
}

/** Tipos de evento disponíveis, para o operador escolher qual o fluxo oferece. */
export async function listarTiposDeEvento(
  db: Db,
  clienteId: string,
): Promise<TipoDeEvento[] | { erro: string }> {
  const conexao = await conexaoCalendly(db, clienteId)
  if ('erro' in conexao) return { erro: conexao.erro }

  const usuario = conexao.config.usuario as string | undefined
  if (!usuario) return { erro: 'conexão sem identificação do usuário — reconecte a conta' }

  return tiposDeEvento(conexao.accessToken, usuario)
}
