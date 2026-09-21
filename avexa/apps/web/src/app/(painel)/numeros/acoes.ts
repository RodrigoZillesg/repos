'use server'

import { revalidatePath } from 'next/cache'
import { eq } from 'drizzle-orm'
import { auditoria, db, projeto } from '@avexa/db'
import {
  adotarNumero,
  credenciaisDoAmbiente,
  renomear,
  webhookDeSms,
  type ResultadoNumero,
} from '@avexa/servicos'
import { sessaoAtual } from '@/lib/auth'

/** Mexer em número é mexer em dinheiro e em identidade.
 *
 *  Renomear muda o que aparece na fatura do Twilio. Adotar reaponta o webhook
 *  de SMS, e o que quer que receba as respostas daquele número hoje para de
 *  receber. As duas coisas ficam em auditoria, e as duas exigem administrar. */

async function exigirAdmin() {
  const s = await sessaoAtual()
  return s?.permissoes.administrar ? s : null
}

function credenciais(): { ok: true; cred: NonNullable<ReturnType<typeof credenciaisDoAmbiente>> } | { ok: false; erro: string } {
  const cred = credenciaisDoAmbiente()
  return cred
    ? { ok: true, cred }
    : { ok: false, erro: 'O Twilio não está configurado neste ambiente (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN).' }
}

export async function renomearNumeroAcao(
  sid: string,
  e164: string,
  apelido: string,
): Promise<ResultadoNumero> {
  const s = await exigirAdmin()
  if (!s) return { ok: false, erro: 'sem permissão' }

  const c = credenciais()
  if (!c.ok) return { ok: false, erro: c.erro }

  const r = await renomear(c.cred, sid, apelido)
  if (!r.ok) return r

  await db().insert(auditoria).values({
    usuarioId: s.usuarioId,
    acao: 'numero.renomear',
    entidade: 'numero',
    entidadeId: sid,
    detalhe: { e164, apelido, por: s.email },
  })

  revalidatePath('/numeros')
  return r
}

export async function adotarNumeroAcao(
  sid: string,
  e164: string,
  projetoId: string,
  capacidades: string[],
): Promise<ResultadoNumero> {
  const s = await exigirAdmin()
  if (!s) return { ok: false, erro: 'sem permissão' }

  const c = credenciais()
  if (!c.ok) return { ok: false, erro: c.erro }

  const r = await adotarNumero(
    db(),
    c.cred,
    { sid, e164, projetoId, capacidades },
    webhookDeSms(),
  )
  if (!r.ok) return r

  const [dono] = await db()
    .select({ clienteId: projeto.clienteId })
    .from(projeto)
    .where(eq(projeto.id, projetoId))
    .limit(1)

  await db().insert(auditoria).values({
    usuarioId: s.usuarioId,
    ...(dono ? { clienteId: dono.clienteId } : {}),
    acao: 'numero.adotar',
    entidade: 'numero',
    entidadeId: sid,
    detalhe: { e164, projetoId, por: s.email },
  })

  // O número vira remetente de SMS e ligação: a tela de cliente e a prontidão
  // passam a ver outro estado.
  revalidatePath('/numeros')
  revalidatePath('/clientes')
  return r
}
