import type {
  AdaptadorCanal,
  EventoRecebido,
  IntencaoContato,
  ResultadoEnvio,
} from '@avexa/core'
import { normalizarEmail } from '@avexa/core'
import { requisitar, type Buscar } from './http.ts'

/** E-mail pelo Resend.
 *
 *  Conexão única da Avexa: um domínio, uma reputação de envio, nenhum cliente
 *  configurando DNS. O remetente é sempre um endereço do domínio da Avexa e a
 *  resposta é direcionada ao time do cliente pelo reply-to. */

export interface ConfigResend {
  apiKey: string
  /** Remetente padrão, no domínio da Avexa. */
  remetente: string
  buscar?: Buscar
}

export function adaptadorResend(cfg: ConfigResend): AdaptadorCanal {
  return {
    canal: 'email',
    provedor: 'resend',

    async enviar(i: IntencaoContato): Promise<ResultadoEnvio> {
      const replyTo = i.opcoes?.replyTo as string | undefined
      const r = await requisitar('https://api.resend.com/emails', {
        cabecalhos: { authorization: `Bearer ${cfg.apiKey}` },
        corpo: {
          from: i.remetente ?? cfg.remetente,
          to: [i.destinatario],
          subject: i.assunto ?? '',
          ...(i.html ? { html: i.html } : { text: i.texto ?? '' }),
          ...(replyTo ? { reply_to: replyTo } : {}),
          // Volta no webhook e liga o evento à tentativa sem depender de busca.
          headers: { 'X-Avexa-Tentativa': i.tentativaId },
        },
        ...(cfg.buscar ? { buscar: cfg.buscar } : {}),
      })

      if (!r.ok) return { ok: false, erro: r.erro ?? '', reenviavel: r.reenviavel }
      const id = (r.corpo as { id?: string } | null)?.id
      return { ok: true, ...(id ? { provedorId: id } : {}) }
    },

    interpretarWebhook(corpo: unknown): EventoRecebido[] {
      const e = corpo as { type?: string; data?: Record<string, unknown> } | null
      if (!e?.type) return []

      const dados = e.data ?? {}
      const provedorId = typeof dados.email_id === 'string' ? dados.email_id : undefined
      const para = Array.isArray(dados.to) ? String(dados.to[0]) : undefined
      const identificador = normalizarEmail(para ?? null) ?? undefined

      const tipo = (
        {
          'email.delivered': 'entregue',
          'email.opened': 'lida',
          'email.bounced': 'bounce',
          'email.complained': 'reclamacao',
          'email.failed': 'falha',
        } as const
      )[e.type]

      if (!tipo) return []
      return [
        {
          canal: 'email',
          tipo,
          ...(provedorId ? { provedorId } : {}),
          ...(identificador ? { identificador } : {}),
          payload: dados,
        },
      ]
    },
  }
}
