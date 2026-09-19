'use server'

import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { cliente, db } from '@avexa/db'
import {
  definirDestino,
  desconectarCalendly,
  desconectarGoogle,
  listarTiposDeEvento,
  type TipoGoogle,
  type TipoOAuth,
} from '@avexa/servicos'
import type { ProvedorAgenda } from '@avexa/core'
import { sessaoAtual } from '@/lib/auth'

async function exigirAdmin() {
  const s = await sessaoAtual()
  return s?.permissoes.administrar ? s : null
}

export async function desligar(clienteId: string, tipo: TipoOAuth): Promise<{ ok: boolean }> {
  if (!(await exigirAdmin())) return { ok: false }
  if (tipo === 'calendly') await desconectarCalendly(db(), clienteId)
  else await desconectarGoogle(db(), clienteId, tipo as TipoGoogle)
  revalidatePath('/integracoes')
  return { ok: true }
}

export async function salvarAgendas(
  clienteId: string,
  calendarios: string,
  rodizio: boolean,
): Promise<{ ok: boolean }> {
  if (!(await exigirAdmin())) return { ok: false }
  await definirDestino(db(), clienteId, 'google_calendar', {
    calendarios: calendarios
      .split(/[\n,]/)
      .map((x) => x.trim())
      .filter(Boolean),
    rodizio,
  })
  revalidatePath('/integracoes')
  return { ok: true }
}

export async function salvarPlanilha(
  clienteId: string,
  planilhaId: string,
  aba: string,
): Promise<{ ok: boolean }> {
  if (!(await exigirAdmin())) return { ok: false }
  // Aceita a URL inteira: ninguém guarda o id de cabeça, e pedir só o id
  // garante que alguém vai colar a URL e ver "não funcionou".
  const id = /\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/.exec(planilhaId)?.[1] ?? planilhaId.trim()
  await definirDestino(db(), clienteId, 'google_sheets', { planilhaId: id, aba: aba.trim() || 'Leads' })
  revalidatePath('/integracoes')
  return { ok: true }
}

/** Guarda a URI e também como ela se chama.
 *
 *  A URI sozinha não diz nada a quem abre a tela depois — "conversa de 30 min"
 *  e "aula demonstrativa de 60" são escolhas diferentes, e conferir qual está
 *  valendo não deveria exigir uma ida ao Calendly. */
export async function salvarTipoDeEvento(
  clienteId: string,
  tipoDeEvento: string,
  nome?: string,
  duracaoMin?: number,
): Promise<{ ok: boolean }> {
  if (!(await exigirAdmin())) return { ok: false }
  await definirDestino(db(), clienteId, 'calendly', {
    tipoDeEvento,
    ...(nome ? { tipoDeEventoNome: nome } : {}),
    ...(duracaoMin ? { tipoDeEventoDuracao: duracaoMin } : {}),
  })
  revalidatePath('/integracoes')
  return { ok: true }
}

export async function buscarTiposDeEvento(
  clienteId: string,
): Promise<{ tipos: Array<{ uri: string; nome: string; duracaoMin: number }> } | { erro: string }> {
  if (!(await exigirAdmin())) return { erro: 'sem permissão' }
  const r = await listarTiposDeEvento(db(), clienteId)
  if ('erro' in r) return r
  return { tipos: r.map((t) => ({ uri: t.uri, nome: t.nome, duracaoMin: t.duracaoMin })) }
}

/** Qual ferramenta de agenda este cliente usa, quando as duas estão conectadas. */
export async function escolherProvedorAgenda(
  clienteId: string,
  provedor: ProvedorAgenda,
): Promise<{ ok: boolean }> {
  if (!(await exigirAdmin())) return { ok: false }
  await db().update(cliente).set({ provedorAgenda: provedor }).where(eq(cliente.id, clienteId))
  revalidatePath('/integracoes')
  return { ok: true }
}
