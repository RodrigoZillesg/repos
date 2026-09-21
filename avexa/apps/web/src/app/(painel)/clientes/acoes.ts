'use server'

import { revalidatePath } from 'next/cache'
import { auditoria, db } from '@avexa/db'
import {
  arquivarProjeto,
  criarProjeto,
  definirCanal,
  renomearProjeto,
  salvarCliente,
  salvarProjeto,
  type CadastroDoCliente,
  type ResultadoCanal,
  type ResultadoProjeto,
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

/** Projetos do cliente.
 *
 *  O projeto existe para dar nome ao número de telefone no Twilio. Criar e
 *  renomear não mexem em nada que esteja no ar — mas ficam em auditoria porque
 *  o nome é o que alguém vai ler na fatura tentando entender uma cobrança. */

export async function criarProjetoAcao(
  clienteId: string,
  nome: string,
): Promise<ResultadoProjeto> {
  const s = await exigirAdmin()
  if (!s) return { ok: false, erro: 'sem permissão' }

  const r = await criarProjeto(db(), clienteId, nome)
  if (!r.ok) return r

  await db().insert(auditoria).values({
    usuarioId: s.usuarioId,
    clienteId,
    acao: 'projeto.criar',
    entidade: 'projeto',
    entidadeId: r.id,
    detalhe: { nome, por: s.email },
  })

  revalidatePath('/clientes')
  revalidatePath('/numeros')
  return r
}

export async function renomearProjetoAcao(
  clienteId: string,
  projetoId: string,
  nome: string,
): Promise<ResultadoProjeto> {
  const s = await exigirAdmin()
  if (!s) return { ok: false, erro: 'sem permissão' }

  const r = await renomearProjeto(db(), projetoId, nome)
  if (!r.ok) return r

  await db().insert(auditoria).values({
    usuarioId: s.usuarioId,
    clienteId,
    acao: 'projeto.renomear',
    entidade: 'projeto',
    entidadeId: projetoId,
    detalhe: { nome, por: s.email },
  })

  revalidatePath('/clientes')
  revalidatePath('/numeros')
  return r
}

export async function arquivarProjetoAcao(
  clienteId: string,
  projetoId: string,
): Promise<ResultadoProjeto> {
  const s = await exigirAdmin()
  if (!s) return { ok: false, erro: 'sem permissão' }

  const r = await arquivarProjeto(db(), projetoId)
  if (!r.ok) return r

  await db().insert(auditoria).values({
    usuarioId: s.usuarioId,
    clienteId,
    acao: 'projeto.arquivar',
    entidade: 'projeto',
    entidadeId: projetoId,
    detalhe: { por: s.email },
  })

  revalidatePath('/clientes')
  revalidatePath('/numeros')
  return r
}

/** Liga e desliga o modo seco de uma frente.
 *
 *  Fica em auditoria porque é a chave que decide se uma IA liga para gente de
 *  verdade. Por projeto: desligar o seco de uma escola não abre a torneira da
 *  outra, e era isso que acontecia quando a chave era do cliente. */
export async function alternarSecoAcao(
  clienteId: string,
  projetoId: string,
  nome: string,
  dryRun: boolean,
): Promise<ResultadoCanal> {
  const s = await exigirAdmin()
  if (!s) return { ok: false, erro: 'sem permissão' }

  const r = await salvarProjeto(db(), projetoId, { nome, dryRun })
  if (!r.ok) return r

  await db().insert(auditoria).values({
    usuarioId: s.usuarioId,
    clienteId,
    acao: dryRun ? 'projeto.seco.ligar' : 'projeto.seco.desligar',
    entidade: 'projeto',
    entidadeId: projetoId,
    detalhe: { nome, por: s.email },
  })

  revalidatePath('/clientes')
  revalidatePath('/fluxos')
  return r
}
