import { createHmac, timingSafeEqual } from 'node:crypto'
import type {
  AdaptadorCanal,
  EventoRecebido,
  IntencaoContato,
  ResultadoEnvio,
} from '@avexa/core'
import { ehPedidoDeParada, normalizarTelefone } from '@avexa/core'
import { requisitar, type Buscar } from './http.ts'

/** SMS pelo Twilio.
 *
 *  Sai do mesmo número que liga para o lead, para ele reconhecer a origem, e
 *  carrega sempre a instrução de opt-out. O Twilio já responde a STOP sozinho,
 *  mas a supressão dele é por conta e por número: quem manda na nossa é o evento
 *  de opt-out que este adaptador devolve, porque a nossa lista é global. */

export interface ConfigTwilio {
  accountSid: string
  authToken: string
  /** Número remetente em E.164, ou SID do Messaging Service. */
  remetente: string
  statusCallback?: string
  buscar?: Buscar
}

export function adaptadorTwilioSms(cfg: ConfigTwilio): AdaptadorCanal {
  return {
    canal: 'sms',
    provedor: 'twilio',

    async enviar(i: IntencaoContato): Promise<ResultadoEnvio> {
      const corpo: Record<string, string> = {
        To: i.destinatario,
        Body: i.texto ?? '',
      }
      // MG… é Messaging Service; qualquer outra coisa é número remetente.
      const de = i.remetente ?? cfg.remetente
      if (de.startsWith('MG')) corpo.MessagingServiceSid = de
      else corpo.From = de
      if (cfg.statusCallback) corpo.StatusCallback = cfg.statusCallback

      const auth = Buffer.from(`${cfg.accountSid}:${cfg.authToken}`).toString('base64')
      const r = await requisitar(
        `https://api.twilio.com/2010-04-01/Accounts/${cfg.accountSid}/Messages.json`,
        {
          cabecalhos: { authorization: `Basic ${auth}` },
          corpo,
          formulario: true,
          ...(cfg.buscar ? { buscar: cfg.buscar } : {}),
        },
      )

      if (!r.ok) return { ok: false, erro: r.erro ?? '', reenviavel: r.reenviavel }
      const sid = (r.corpo as { sid?: string } | null)?.sid
      return { ok: true, ...(sid ? { provedorId: sid } : {}) }
    },

    interpretarWebhook(corpo: unknown): EventoRecebido[] {
      const c = (corpo ?? {}) as Record<string, string>
      const provedorId = c.MessageSid ?? c.SmsSid
      const identificador = normalizarTelefone(c.From ?? null, 'US') ?? undefined

      // Mensagem recebida do lead.
      if (c.Body !== undefined && !c.MessageStatus) {
        return [
          {
            canal: 'sms',
            tipo: ehPedidoDeParada(c.Body) ? 'optout' : 'respondida',
            ...(provedorId ? { provedorId } : {}),
            ...(identificador ? { identificador } : {}),
            texto: c.Body,
            payload: c,
          },
        ]
      }

      // Atualização de status de uma mensagem que enviamos.
      const tipo = (
        { delivered: 'entregue', undelivered: 'falha', failed: 'falha' } as const
      )[c.MessageStatus ?? '']
      if (!tipo) return []
      return [
        { canal: 'sms', tipo, ...(provedorId ? { provedorId } : {}), payload: c },
      ]
    },
  }
}

/** Confere a assinatura do webhook do Twilio.
 *
 *  Sem isto, `/api/webhooks/sms` aceita qualquer POST de qualquer um. E o
 *  estrago não é teórico: basta mandar `Body=STOP&From=<numero>` para pôr o
 *  número de um lead real na supressão global e calar o contato com ele. Ou
 *  forjar "o lead respondeu" e fazer o motor abandonar a sequência.
 *
 *  O algoritmo é o do Twilio: HMAC-SHA1 do authToken sobre a URL exata que
 *  ele chamou, concatenada com os pares do formulário ordenados por chave.
 *  A URL tem que ser a pública — atrás do nginx, a URL que o Next monta é
 *  http://0.0.0.0:3000 e a assinatura nunca bateria. */
export function conferirAssinaturaTwilio(
  authToken: string,
  url: string,
  parametros: Record<string, string>,
  assinatura: string | null | undefined,
): boolean {
  if (!assinatura || !authToken) return false

  const dados =
    url +
    Object.keys(parametros)
      .sort()
      .map((k) => k + parametros[k])
      .join('')

  const esperado = createHmac('sha1', authToken).update(dados, 'utf8').digest('base64')

  // Comparação em tempo constante: comparar com === vaza, pelo tempo, quantos
  // bytes iniciais o atacante acertou.
  const a = Buffer.from(esperado)
  const b = Buffer.from(assinatura)
  return a.length === b.length && timingSafeEqual(a, b)
}
