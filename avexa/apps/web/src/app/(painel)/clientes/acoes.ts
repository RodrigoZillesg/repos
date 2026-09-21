'use server'

import { revalidatePath } from 'next/cache'
import { auditoria, db } from '@avexa/db'
import {
  definirCanal,
  salvarCliente,
  type CadastroDoCliente,
  type ResultadoCanal,
} from '@avexa/servicos'
import type { Canal } from '@avexa/core'
import { sessaoAtual } from '@/lib/auth'

/** Edição de um cliente já ativado.
 *
 *  Até aqui a ativação era a única chance de decidir canal, fuso e modo seco —
 *  e não devia ser: cliente contrata SMS no segundo mês, desiste de ligação,
 *  descobre que o fuso estava errado. */

async function exigirAdmin() {
  const s = await sessaoAtual()
  return s?.permissoes.administrar ? s : null
}

export async function salvarCadastro(
  clienteId: string,
  d: CadastroDoCliente,
): Promise<ResultadoCanal> {
  const s = await exigirAdmin()
  if (!s) return { ok: false, erro: 'sem permissão' }

  const r = await salvarCliente(db(), clienteId, d)
  if (!r.ok) return r

  await db().insert(auditoria).values({
    usuarioId: s.usuarioId,
    clienteId,
    acao: 'cliente.salvar',
    entidade: 'cliente',
    entidadeId: clienteId,
    detalhe: { ...d },
  })

  revalidatePath('/clientes')
  return r
}

/** Liga ou desliga um canal.
 *
 *  Fica em auditoria porque muda o que o motor faz com gente de verdade:
 *  desligar um canal cala todas as etapas dele nos fluxos publicados, e ligar
 *  libera contato por uma via nova. */
export async function alternarCanal(
  clienteId: string,
  canal: Canal,
  ativo: boolean,
): Promise<ResultadoCanal> {
  const s = await exigirAdmin()
  if (!s) return { ok: false, erro: 'sem permissão' }

  const r = await definirCanal(db(), clienteId, canal, ativo)
  if (!r.ok) return r

  await db().insert(auditoria).values({
    usuarioId: s.usuarioId,
    clienteId,
    acao: ativo ? 'canal.ligar' : 'canal.desligar',
    entidade: 'cliente_canal',
    entidadeId: clienteId,
    detalhe: { canal, por: s.email },
  })

  // O canal decide o que a paleta do construtor oferece e o que a validação
  // reclama, então as duas telas precisam relerem.
  revalidatePath('/clientes')
  revalidatePath('/fluxos')
  return r
}
