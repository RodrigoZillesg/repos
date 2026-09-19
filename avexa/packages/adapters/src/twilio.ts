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
