import type {
  AdaptadorCanal,
  EventoRecebido,
  IntencaoContato,
  ResultadoEnvio,
} from '@avexa/core'
import { ehPedidoDeParada, normalizarTelefone } from '@avexa/core'
import { requisitar, type Buscar } from './http.ts'

/** WhatsApp pela Cloud API oficial.
 *
 *  Os números e a conta verificada são da marca Avexa: cliente novo entra no
 *  roteamento, não num cadastro novo. Fora da janela de 24 horas só sai template
 *  aprovado; depois que o lead responde, a conversa é livre. Quem decide qual dos
 *  dois usar é o fluxo, não este adaptador. */

export interface ConfigWhatsApp {
  /** Token de sistema da WABA. */
  token: string
  /** Id do número remetente na Cloud API. */
  phoneNumberId: string
  versao?: string
  buscar?: Buscar
}

const VERSAO_PADRAO = 'v21.0'

export function adaptadorWhatsApp(cfg: ConfigWhatsApp): AdaptadorCanal {
  const base = `https://graph.facebook.com/${cfg.versao ?? VERSAO_PADRAO}`

  return {
    canal: 'whatsapp',
    provedor: 'meta-cloud-api',

    async enviar(i: IntencaoContato): Promise<ResultadoEnvio> {
      const usarTemplate = Boolean(i.templateExterno)

      const corpo = usarTemplate
        ? {
            messaging_product: 'whatsapp',
            to: i.destinatario,
            type: 'template',
            template: {
              name: i.templateExterno,
              language: { code: (i.opcoes?.idioma as string) ?? 'en' },
              // A Cloud API recebe as variáveis por posição, na ordem em que
              // aparecem no corpo aprovado.
              components: [
                {
                  type: 'body',
                  parameters: Object.values(i.variaveis ?? {}).map((v) => ({
                    type: 'text',
                    text: String(v),
                  })),
                },
              ],
            },
          }
        : {
            messaging_product: 'whatsapp',
            to: i.destinatario,
            type: 'text',
            text: { body: i.texto ?? '' },
          }

      const r = await requisitar(`${base}/${cfg.phoneNumberId}/messages`, {
        cabecalhos: { authorization: `Bearer ${cfg.token}` },
        corpo,
        ...(cfg.buscar ? { buscar: cfg.buscar } : {}),
      })

      if (!r.ok) {
        const e = (r.corpo as { error?: { code?: number; message?: string } } | null)?.error
        // 131047 é "fora da janela de 24h": erro de fluxo, não de transporte.
        // Reenviar não resolve; o fluxo precisa usar template.
        const foraDaJanela = e?.code === 131047
        return {
          ok: false,
          erro: e?.message ?? r.erro ?? '',
          reenviavel: r.reenviavel && !foraDaJanela,
          detalhe: { codigoMeta: e?.code ?? null, foraDaJanela },
        }
      }

      const id = (r.corpo as { messages?: Array<{ id?: string }> } | null)?.messages?.[0]?.id
      return { ok: true, ...(id ? { provedorId: id } : {}) }
    },

    interpretarWebhook(corpo: unknown): EventoRecebido[] {
      const c = corpo as
        | {
            entry?: Array<{
              changes?: Array<{
                value?: {
                  statuses?: Array<Record<string, unknown>>
                  messages?: Array<Record<string, unknown>>
                }
              }>
            }>
          }
        | null

      const eventos: EventoRecebido[] = []

      for (const entrada of c?.entry ?? []) {
        for (const mudanca of entrada.changes ?? []) {
          const valor = mudanca.value ?? {}

          for (const s of valor.statuses ?? []) {
            const tipo = (
              { delivered: 'entregue', read: 'lida', failed: 'falha' } as const
            )[String(s.status)]
            if (!tipo) continue
            eventos.push({
              canal: 'whatsapp',
              tipo,
              ...(typeof s.id === 'string' ? { provedorId: s.id } : {}),
              payload: s,
            })
          }

          for (const m of valor.messages ?? []) {
            const texto =
              (m.text as { body?: string } | undefined)?.body ??
              (m.button as { text?: string } | undefined)?.text ??
              ''
            // A Cloud API entrega o `from` em formato internacional, porém sem
            // o `+`. Sem recolocá-lo, o número cairia na regra nacional e não
            // casaria com a supressão global.
            const bruto = typeof m.from === 'string' ? m.from : null
            const de = normalizarTelefone(bruto && !bruto.startsWith('+') ? `+${bruto}` : bruto)
            eventos.push({
              canal: 'whatsapp',
              tipo: ehPedidoDeParada(texto) ? 'optout' : 'respondida',
              ...(de ? { identificador: de } : {}),
              texto,
              payload: m,
            })
          }
        }
      }
      return eventos
    },
  }
}
