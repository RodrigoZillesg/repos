'use server'

import { revalidatePath } from 'next/cache'
import { db } from '@avexa/db'
import { ativarCliente, paraSlug, type ResultadoAtivacao } from '@avexa/servicos'
import type { Canal } from '@avexa/core'
import { sessaoAtual } from '@/lib/auth'

export interface FormAtivacao {
  nome: string
  slug: string
  produto: string
  setor: string
  fusoHorario: string
  emailDoTime: string
  canais: Record<string, boolean>
  fluxosExtras: string
}

export async function ativar(entrada: FormAtivacao): Promise<ResultadoAtivacao> {
  const s = await sessaoAtual()
  // Provisionar cria número de voz, templates e fluxos publicados. Só quem
  // administra contas faz isso — e a checagem é aqui, no servidor.
  if (!s?.permissoes.administrar) {
    return { ok: false, passos: [], urls: [], avisos: [], erro: 'sem permissão para ativar clientes' }
  }

  if (!entrada.nome.trim()) {
    return { ok: false, passos: [], urls: [], avisos: [], erro: 'o cliente precisa de um nome' }
  }
  if (!entrada.produto.trim()) {
    return {
      ok: false,
      passos: [],
      urls: [],
      avisos: [],
      erro: 'diga o que o cliente vende: é isso que preenche os templates e o roteiro de voz',
    }
  }
  if (!Object.values(entrada.canais).some(Boolean)) {
    return { ok: false, passos: [], urls: [], avisos: [], erro: 'escolha ao menos um canal' }
  }

  const r = await ativarCliente(db(), {
    nome: entrada.nome.trim(),
    slug: paraSlug(entrada.slug || entrada.nome),
    produto: entrada.produto.trim(),
    fusoHorario: entrada.fusoHorario,
    canais: entrada.canais as Record<Canal, boolean>,
    ...(entrada.setor.trim() ? { setor: entrada.setor.trim() } : {}),
    ...(entrada.emailDoTime.trim() ? { emailDoTime: entrada.emailDoTime.trim() } : {}),
    fluxosExtras: entrada.fluxosExtras
      .split('\n')
      .map((x) => x.trim())
      .filter(Boolean),
  })

  if (r.ok) {
    revalidatePath('/ativar')
    revalidatePath('/fluxos')
  }
  return r
}
