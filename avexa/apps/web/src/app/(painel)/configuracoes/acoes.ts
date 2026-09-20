'use server'

import { revalidatePath } from 'next/cache'
import { headers } from 'next/headers'
import { eq } from 'drizzle-orm'
import { auditoria, configGlobal, db, usuario } from '@avexa/db'
import { convidarUsuario, definirAtivo, type Papel } from '@avexa/servicos'
import { enviarConvite, sessaoAtual } from '@/lib/auth'
import { basePublica } from '@/lib/url'

export interface Ajustes {
  tetoTentativas: number
  janelaInicioMin: number
  janelaFimMin: number
  contatarSabado: boolean
  contatarDomingo: boolean
  intervaloMinimoMin: number
  profundidadeMaxSubfluxo: number
  retencaoLeadDias: number
  retencaoGravacaoDias: number
}

const limitar = (n: number, min: number, max: number) =>
  Math.max(min, Math.min(max, Math.round(Number.isFinite(n) ? n : min)))

export async function salvarAjustes(a: Ajustes): Promise<{ ok: boolean; erro?: string }> {
  const s = await sessaoAtual()
  if (!s?.permissoes.administrar) return { ok: false, erro: 'sem permissão' }

  // Teto é teto: um valor absurdo aqui vira contato demais na vida de alguém.
  // Os limites do limite são conservadores de propósito.
  const v: Ajustes = {
    tetoTentativas: limitar(a.tetoTentativas, 1, 20),
    janelaInicioMin: limitar(a.janelaInicioMin, 0, 24 * 60 - 1),
    janelaFimMin: limitar(a.janelaFimMin, 0, 24 * 60 - 1),
    contatarSabado: Boolean(a.contatarSabado),
    contatarDomingo: Boolean(a.contatarDomingo),
    intervaloMinimoMin: limitar(a.intervaloMinimoMin, 5, 7 * 24 * 60),
    profundidadeMaxSubfluxo: limitar(a.profundidadeMaxSubfluxo, 1, 10),
    retencaoLeadDias: limitar(a.retencaoLeadDias, 0, 3650),
    retencaoGravacaoDias: limitar(a.retencaoGravacaoDias, 0, 3650),
  }

  if (v.janelaFimMin <= v.janelaInicioMin) {
    return { ok: false, erro: 'A janela precisa terminar depois de começar.' }
  }
  // Gravação guardada mais tempo que o lead é uma política que se contradiz: o
  // áudio continuaria aqui depois de o dono dele ter sido apagado.
  if (v.retencaoLeadDias > 0 && v.retencaoGravacaoDias > v.retencaoLeadDias) {
    return {
      ok: false,
      erro: 'A gravação não pode durar mais que o lead: ela é dado da mesma pessoa.',
    }
  }

  const [existente] = await db().select().from(configGlobal).where(eq(configGlobal.id, 1)).limit(1)
  if (existente) {
    await db()
      .update(configGlobal)
      .set({ ...v, atualizadoEm: new Date(), atualizadoPor: s.usuarioId })
      .where(eq(configGlobal.id, 1))
  } else {
    await db()
      .insert(configGlobal)
      .values({ id: 1, ...v, atualizadoPor: s.usuarioId })
  }

  // Mudar teto de tentativas ou retenção é decisão com consequência em cima de
  // gente. Fica na trilha, com autor e valores.
  await db().insert(auditoria).values({
    usuarioId: s.usuarioId,
    acao: 'config.salvar',
    entidade: 'config_global',
    entidadeId: '1',
    detalhe: { de: existente ?? null, para: v },
  })

  revalidatePath('/configuracoes')
  return { ok: true }
}

/* --------------------------------- Acesso --------------------------------- */

export interface FormConvite {
  email: string
  nome: string
  papel: Papel
  /** Só para o papel `cliente`. */
  clienteId: string
}

export interface ResultadoAcesso {
  ok: boolean
  erro?: string
  /** Quando o e-mail não saiu, o link volta para quem convidou repassar.
   *  Some da tela ao recarregar: é de uso único e vale 15 minutos. */
  link?: string
  aviso?: string
}

/** Cria o usuário e manda o link de entrada.
 *
 *  Antes disto, dar acesso a um cliente era um INSERT no banco. Além de
 *  incômodo, não deixava registro de quem decidiu — e decidir quem enxerga os
 *  leads de uma empresa é exatamente o tipo de coisa que precisa de registro. */
export async function convidar(f: FormConvite): Promise<ResultadoAcesso> {
  const s = await sessaoAtual()
  if (!s?.permissoes.administrar) return { ok: false, erro: 'sem permissão' }

  const r = await convidarUsuario(db(), {
    email: f.email,
    nome: f.nome,
    papel: f.papel,
    clienteId: f.papel === 'cliente' ? f.clienteId : null,
  })
  if (!r.ok) return { ok: false, erro: r.erro }

  await db().insert(auditoria).values({
    usuarioId: s.usuarioId,
    ...(r.usuario.clienteId ? { clienteId: r.usuario.clienteId } : {}),
    acao: 'acesso.convidar',
    entidade: 'usuario',
    entidadeId: r.usuario.id,
    detalhe: { email: r.usuario.email, papel: r.usuario.papel, por: s.email },
  })

  const envio = await enviarConvite(r.usuario.email, basePublica(await headers()), s.nome)
  revalidatePath('/configuracoes')

  // O usuário existe de qualquer jeito. O que muda é se ele soube disso: sem o
  // e-mail, quem convidou precisa repassar o link, ou a pessoa fica trancada
  // sem ninguém entender por quê.
  if (!envio.enviado) {
    return {
      ok: true,
      aviso: `${r.usuario.nome} foi criado, mas o e-mail não saiu. Passe este link — ele vale 15 minutos e funciona uma vez.`,
      ...(envio.link ? { link: envio.link } : {}),
    }
  }
  return { ok: true }
}

/** Manda outro link para quem já existe. O anterior expirou ou se perdeu. */
export async function reenviar(usuarioId: string): Promise<ResultadoAcesso> {
  const s = await sessaoAtual()
  if (!s?.permissoes.administrar) return { ok: false, erro: 'sem permissão' }

  const [u] = await db().select().from(usuario).where(eq(usuario.id, usuarioId)).limit(1)
  if (!u) return { ok: false, erro: 'usuário não encontrado' }
  if (!u.ativo) return { ok: false, erro: 'usuário desativado — reative antes de mandar o link' }

  const envio = await enviarConvite(u.email, basePublica(await headers()), s.nome)
  if (!envio.enviado) {
    return {
      ok: true,
      aviso: 'O e-mail não saiu. Passe este link — ele vale 15 minutos e funciona uma vez.',
      ...(envio.link ? { link: envio.link } : {}),
    }
  }
  return { ok: true }
}

/** Liga e desliga o acesso. Não apaga: apagar levaria a trilha junto. */
export async function alternarAcesso(
  usuarioId: string,
  ativo: boolean,
): Promise<ResultadoAcesso> {
  const s = await sessaoAtual()
  if (!s?.permissoes.administrar) return { ok: false, erro: 'sem permissão' }
  // Desativar a si mesmo tranca quem está com a mão no volante, e a tela para
  // desfazer é justamente esta.
  if (usuarioId === s.usuarioId) {
    return { ok: false, erro: 'você não pode desativar o próprio acesso' }
  }

  const r = await definirAtivo(db(), usuarioId, ativo)
  if (!r.ok) return { ok: false, ...(r.erro ? { erro: r.erro } : {}) }

  await db().insert(auditoria).values({
    usuarioId: s.usuarioId,
    acao: ativo ? 'acesso.reativar' : 'acesso.desativar',
    entidade: 'usuario',
    entidadeId: usuarioId,
    detalhe: { por: s.email },
  })

  revalidatePath('/configuracoes')
  return { ok: true }
}
