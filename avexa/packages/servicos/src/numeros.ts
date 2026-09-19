import { and, eq } from 'drizzle-orm'
import { clienteCanal, numero, type Db } from '@avexa/db'
import {
  apontarWebhookSms,
  buscarNumerosDisponiveis,
  comprarNumero,
  type CredenciaisTwilio,
  type NumeroDisponivel,
  type TipoDeNumero,
} from '@avexa/adapters'

/** Números de telefone: comprar, guardar e atribuir a cliente.
 *
 *  Cada cliente fala do próprio número — o lead reconhece quem o procurou, e o
 *  SMS sai do mesmo número que liga. O pool existe para que a atribuição na
 *  ativação seja instantânea; comprar na hora atrasaria a ativação e deixaria
 *  o operador esperando o Twilio. */

export function credenciaisDoAmbiente(
  env: Record<string, string | undefined> = process.env,
): CredenciaisTwilio | null {
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN) return null
  return { accountSid: env.TWILIO_ACCOUNT_SID, authToken: env.TWILIO_AUTH_TOKEN }
}

/** A URL para onde o Twilio manda resposta e opt-out do lead.
 *
 *  Sai de DOMINIO, a mesma identidade canônica que o painel usa. Um número
 *  comprado sem webhook recebe mensagem e joga fora em silêncio — e o pedido
 *  de parada de um lead é a mensagem que menos se pode perder. */
export function webhookDeSms(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const dominio = env.DOMINIO?.trim().replace(/\/+$/, '')
  return dominio ? `https://${dominio}/api/webhooks/sms` : null
}

export type ResultadoProvisionar =
  | { ok: true; e164: string; sid: string; atribuido: boolean }
  | { ok: false; erro: string }

/** Ordem de procura. Local primeiro porque é o mais barato e o mais comum;
 *  Mobile logo atrás porque na Austrália é ele que manda SMS, e procurar só
 *  em Local faria a compra falhar dizendo que não há número no país. */
const TIPOS: TipoDeNumero[] = ['Local', 'Mobile', 'TollFree']

export interface PedidoDeNumero {
  pais: string
  contem?: string
  /** Já deixa o número reservado para este cliente e o põe como remetente dos
   *  canais de telefone dele. Sem isto, entra no pool como livre. */
  clienteId?: string
  apelido?: string
}

/** Compra um número no Twilio e registra no banco.
 *
 *  Gasta dinheiro de verdade, todo mês, por número. */
export async function provisionarNumero(
  db: Db,
  cred: CredenciaisTwilio,
  p: PedidoDeNumero,
  webhook?: string | null,
): Promise<ResultadoProvisionar> {
  let escolhido: NumeroDisponivel | null = null
  let ultimoErro = ''

  for (const tipo of TIPOS) {
    const r = await buscarNumerosDisponiveis(cred, {
      pais: p.pais,
      tipo,
      exigeVoz: true,
      limite: 5,
      ...(p.contem ? { contem: p.contem } : {}),
    })
    if (!r.ok) {
      ultimoErro = r.erro
      continue
    }
    escolhido = escolher(r.numeros)
    if (escolhido) break
  }

  if (!escolhido) {
    return {
      ok: false,
      erro:
        `nenhum número com voz e SMS disponível em ${p.pais.toUpperCase()}` +
        (ultimoErro ? ` (${ultimoErro})` : '') +
        '. Confira o cadastro regulatório e o endereço da conta no console do Twilio.',
    }
  }

  const compra = await comprarNumero(cred, {
    e164: escolhido.e164,
    ...(webhook ? { webhookSms: webhook } : {}),
    ...(p.apelido ? { apelido: p.apelido } : {}),
  })
  if (!compra.ok) return { ok: false, erro: compra.erro }

  // O número já é nosso e já custa. Se o registro falhar daqui para a frente,
  // ele existe no Twilio e não no banco — por isso grava antes de atribuir.
  await db
    .insert(numero)
    .values({
      e164: compra.numero.e164,
      provedor: 'twilio',
      provedorSid: compra.numero.sid,
      capacidades: compra.numero.capacidades,
      status: p.clienteId ? 'atribuido' : 'livre',
      ...(p.clienteId ? { clienteId: p.clienteId } : {}),
    })
    .onConflictDoNothing()

  if (p.clienteId) {
    await definirRemetente(db, p.clienteId, compra.numero.e164)
  }

  return { ok: true, e164: compra.numero.e164, sid: compra.numero.sid, atribuido: !!p.clienteId }
}

/** Prefere quem tem voz E SMS: o motor liga e manda SMS do mesmo número, e um
 *  número só de SMS quebraria a etapa de voz sem aviso. */
export function escolher(numeros: NumeroDisponivel[]): NumeroDisponivel | null {
  const completo = numeros.find(
    (n) => n.capacidades.includes('voz') && n.capacidades.includes('sms'),
  )
  return completo ?? null
}

/** Põe o número como remetente dos canais de telefone do cliente.
 *
 *  SMS e ligação juntos, de propósito: o lead precisa ver o mesmo número nos
 *  dois. Receber SMS de um número e ligação de outro parece golpe. */
export async function definirRemetente(db: Db, clienteId: string, e164: string): Promise<void> {
  for (const canal of ['sms', 'ligacao'] as const) {
    const [linha] = await db
      .select({ id: clienteCanal.id, config: clienteCanal.config })
      .from(clienteCanal)
      .where(and(eq(clienteCanal.clienteId, clienteId), eq(clienteCanal.canal, canal)))
      .limit(1)

    if (linha) {
      await db
        .update(clienteCanal)
        .set({ config: { ...linha.config, numero: e164 } })
        .where(eq(clienteCanal.id, linha.id))
    } else {
      // O canal pode não existir ainda se o número for comprado antes da
      // ativação. Nasce desligado: comprar número não é contratar canal.
      await db
        .insert(clienteCanal)
        .values({ clienteId, canal, ativo: false, config: { numero: e164 } })
    }
  }
}

/** Reaponta o webhook de todos os números para o domínio atual.
 *
 *  Um número apontando para um domínio velho recebe o opt-out do lead e o
 *  entrega em lugar nenhum. */
export async function reapontarWebhooks(
  db: Db,
  cred: CredenciaisTwilio,
  webhook: string,
): Promise<Array<{ e164: string; ok: boolean; erro?: string }>> {
  const todos = await db
    .select({ e164: numero.e164, sid: numero.provedorSid })
    .from(numero)
    .where(eq(numero.provedor, 'twilio'))

  const saida: Array<{ e164: string; ok: boolean; erro?: string }> = []
  for (const n of todos) {
    if (!n.sid) {
      saida.push({ e164: n.e164, ok: false, erro: 'sem SID: número não veio desta automação' })
      continue
    }
    const r = await apontarWebhookSms(cred, n.sid, webhook)
    saida.push({ e164: n.e164, ...r })
  }
  return saida
}
