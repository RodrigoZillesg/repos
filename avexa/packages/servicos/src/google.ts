import type { Db } from '@avexa/db'
import {
  ESCOPOS,
  acrescentarLinha,
  configGoogleDoAmbiente,
  garantirCabecalho,
  listarAgendas,
  renovarAcesso,
  revogar,
  trocarCodigo,
  urlDeConsentimento,
  type AgendaDoGoogle,
} from '@avexa/adapters'
import {
  conexaoValida,
  lerConexao,
  montarState,
  refreshTokenDe,
  removerIntegracao,
  salvarCredenciais,
  type Conexao,
  type FalhaConexao,
} from './oauth.ts'

/** Google Workspace por cliente: Calendar e Sheets. */

export type TipoGoogle = 'google_calendar' | 'google_sheets'

/** Configurado quer dizer que dá para conectar E para guardar com segurança.
 *  Sem APP_SECRET não há como cifrar o refresh token, e oferecer o botão seria
 *  oferecer uma conexão que quebra depois do consentimento. */
export function googleConfigurado(): boolean {
  return configGoogleDoAmbiente() !== null && (process.env.APP_SECRET ?? '').length >= 32
}

export function urlParaConectarGoogle(projetoId: string, tipo: TipoGoogle): string | null {
  const cfg = configGoogleDoAmbiente()
  if (!cfg || !googleConfigurado()) return null
  return urlDeConsentimento(cfg, ESCOPOS[tipo], montarState(projetoId, tipo))
}

export async function concluirConexaoGoogle(
  db: Db,
  projetoId: string,
  tipo: TipoGoogle,
  codigo: string,
): Promise<{ ok: boolean; erro?: string }> {
  const cfg = configGoogleDoAmbiente()
  if (!cfg) return { ok: false, erro: 'Google não configurado neste ambiente' }

  const cred = await trocarCodigo(cfg, codigo)
  if ('erro' in cred) return { ok: false, erro: cred.erro }
  if (!cred.refreshToken) {
    // Sem refresh token a conexão morre em uma hora e o cliente acha que está
    // conectado. Melhor recusar agora.
    return {
      ok: false,
      erro: 'O Google não devolveu um token de longa duração. Remova o acesso do Avexa na conta e conecte de novo.',
    }
  }

  await salvarCredenciais(db, projetoId, tipo, {
    accessToken: cred.accessToken,
    refreshToken: cred.refreshToken,
    expiraEm: cred.expiraEm,
    extra: { escopos: cred.escopos },
  })
  return { ok: true }
}

export async function conexaoGoogle(
  db: Db,
  projetoId: string,
  tipo: TipoGoogle,
): Promise<Conexao | FalhaConexao> {
  const cfg = configGoogleDoAmbiente()
  if (!cfg) return { erro: 'Google não configurado neste ambiente' }
  return conexaoValida(db, projetoId, tipo, async (refresh) => {
    const r = await renovarAcesso(cfg, refresh)
    if ('erro' in r) return { ok: false, erro: r.erro, ...(r.revogado ? { revogado: true } : {}) }
    return {
      ok: true,
      cred: {
        accessToken: r.accessToken,
        refreshToken: r.refreshToken,
        expiraEm: r.expiraEm,
        extra: { escopos: r.escopos },
      },
    }
  })
}

export async function desconectarGoogle(db: Db, projetoId: string, tipo: TipoGoogle): Promise<void> {
  const cfg = configGoogleDoAmbiente()
  const linha = await lerConexao(db, projetoId, tipo)
  // Revoga no Google também: desligar só aqui deixaria o consentimento ativo na
  // conta do cliente, o que não é o que ele pediu ao clicar em desconectar.
  const refresh = linha ? refreshTokenDe(projetoId, tipo, linha.segredo) : null
  if (cfg && refresh) await revogar(cfg, refresh)
  await removerIntegracao(db, projetoId, tipo)
}

/** As agendas que a conta conectada deste cliente enxerga.
 *
 *  Existe para a tela oferecer escolha em vez de pedir e-mail digitado: um id
 *  errado só aparecia na hora de marcar, como "nenhuma das agendas
 *  configuradas está acessível", com um lead quente esperando. */
export async function listarAgendasDoCliente(
  db: Db,
  projetoId: string,
): Promise<AgendaDoGoogle[] | { erro: string }> {
  const conexao = await conexaoGoogle(db, projetoId, 'google_calendar')
  if ('erro' in conexao) return { erro: conexao.erro }
  return listarAgendas(conexao.accessToken)
}

export const CABECALHO_PLANILHA = [
  'Recebido em',
  'Nome',
  'Telefone',
  'E-mail',
  'Score',
  'Motivo',
  'Resumo',
  'Etiquetas',
  'utm_source',
  'utm_campaign',
] as const

export async function registrarNaPlanilha(
  db: Db,
  projetoId: string,
  valores: readonly (string | number | null)[],
): Promise<{ ok: boolean; erro?: string }> {
  const conexao = await conexaoGoogle(db, projetoId, 'google_sheets')
  if ('erro' in conexao) return { ok: false, erro: conexao.erro }

  const planilhaId = conexao.config.planilhaId as string | undefined
  const aba = (conexao.config.aba as string | undefined) ?? 'Leads'
  if (!planilhaId) return { ok: false, erro: 'nenhuma planilha escolhida para este cliente' }

  await garantirCabecalho(conexao.accessToken, planilhaId, aba, CABECALHO_PLANILHA)
  const r = await acrescentarLinha(conexao.accessToken, planilhaId, aba, valores)
  return 'erro' in r ? { ok: false, erro: r.erro } : { ok: true }
}
