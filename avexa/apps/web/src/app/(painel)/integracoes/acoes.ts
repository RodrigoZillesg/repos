'use server'

import { revalidatePath } from 'next/cache'
import { db } from '@avexa/db'
import { definirDestino, desconectar, type TipoGoogle } from '@avexa/servicos'
import { sessaoAtual } from '@/lib/auth'

export async function desligar(clienteId: string, tipo: TipoGoogle): Promise<{ ok: boolean }> {
  const s = await sessaoAtual()
  if (!s?.permissoes.administrar) return { ok: false }
  await desconectar(db(), clienteId, tipo)
  revalidatePath('/integracoes')
  return { ok: true }
}

export async function salvarAgendas(
  clienteId: string,
  calendarios: string,
): Promise<{ ok: boolean }> {
  const s = await sessaoAtual()
  if (!s?.permissoes.administrar) return { ok: false }
  await definirDestino(db(), clienteId, 'google_calendar', {
    calendarios: calendarios
      .split(/[\n,]/)
      .map((x) => x.trim())
      .filter(Boolean),
  })
  revalidatePath('/integracoes')
  return { ok: true }
}

export async function salvarPlanilha(
  clienteId: string,
  planilhaId: string,
  aba: string,
): Promise<{ ok: boolean }> {
  const s = await sessaoAtual()
  if (!s?.permissoes.administrar) return { ok: false }

  // Aceita a URL inteira da planilha: ninguém guarda o id de cabeça, e pedir só
  // o id garante que alguém vai colar a URL e ver "não funcionou".
  const id = /\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/.exec(planilhaId)?.[1] ?? planilhaId.trim()

  await definirDestino(db(), clienteId, 'google_sheets', {
    planilhaId: id,
    aba: aba.trim() || 'Leads',
  })
  revalidatePath('/integracoes')
  return { ok: true }
}
