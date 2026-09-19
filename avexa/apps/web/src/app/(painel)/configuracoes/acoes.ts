'use server'

import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { auditoria, configGlobal, db } from '@avexa/db'
import { sessaoAtual } from '@/lib/auth'

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
