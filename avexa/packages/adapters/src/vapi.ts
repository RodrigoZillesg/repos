import type {
  AdaptadorCanal,
  EventoRecebido,
  IntencaoContato,
  ResultadoEnvio,
} from '@avexa/core'
import { ehPedidoDeParada, normalizarTelefone } from '@avexa/core'
import { requisitar, type Buscar } from './http.ts'

/** Ligação com assistente de IA pelo Vapi, sobre número do Twilio.
 *
 *  Voz é o único canal com número dedicado por cliente, e o mesmo número manda o
 *  SMS, para o lead reconhecer a origem. A gravação é sempre ligada e anunciada
 *  na abertura da chamada — cobre os estados de consentimento bilateral nos EUA
 *  e na Austrália sem depender de configuração por cliente. */

export interface ConfigVapi {
  apiKey: string
  /** Id do assistente configurado para o cliente. */
  assistantId: string
  /** Id do número no Vapi, importado do Twilio. */
  phoneNumberId: string
  buscar?: Buscar
}

const AVISO_GRAVACAO =
  'This call is recorded for quality and training purposes. / Esta chamada é gravada para fins de qualidade e treinamento.'

export function adaptadorVapi(cfg: ConfigVapi): AdaptadorCanal {
  return {
    canal: 'ligacao',
    provedor: 'vapi',

    async enviar(i: IntencaoContato): Promise<ResultadoEnvio> {
      const r = await requisitar('https://api.vapi.ai/call', {
        cabecalhos: { authorization: `Bearer ${cfg.apiKey}` },
        corpo: {
          assistantId: (i.opcoes?.assistantId as string) ?? cfg.assistantId,
          phoneNumberId: (i.opcoes?.phoneNumberId as string) ?? cfg.phoneNumberId,
          customer: { number: i.destinatario },
          assistantOverrides: {
            // O aviso vai na primeira fala, não numa configuração que alguém
            // possa desligar por engano.
            firstMessage: `${AVISO_GRAVACAO} ${i.texto ?? ''}`.trim(),
            variableValues: i.variaveis ?? {},
            recordingEnabled: true,
            ...(i.opcoes?.roteiro ? { model: { messages: [{ role: 'system', content: String(i.opcoes.roteiro) }] } } : {}),
            ...(i.opcoes?.tempoToqueSegundos
              ? { silenceTimeoutSeconds: Number(i.opcoes.tempoToqueSegundos) }
              : {}),
          },
          metadata: { tentativaId: i.tentativaId },
        },
        ...(cfg.buscar ? { buscar: cfg.buscar } : {}),
      })

      if (!r.ok) return { ok: false, erro: r.erro ?? '', reenviavel: r.reenviavel }
      const id = (r.corpo as { id?: string } | null)?.id
      return { ok: true, ...(id ? { provedorId: id } : {}) }
    },

    interpretarWebhook(corpo: unknown): EventoRecebido[] {
      const m = (corpo as { message?: Record<string, unknown> } | null)?.message
      if (!m || m.type !== 'end-of-call-report') return []

      const chamada = (m.call ?? {}) as Record<string, unknown>
      const provedorId = typeof chamada.id === 'string' ? chamada.id : undefined
      const cliente = (chamada.customer ?? {}) as { number?: string }
      const identificador = normalizarTelefone(cliente.number ?? null, 'US') ?? undefined
      const transcricao = typeof m.transcript === 'string' ? m.transcript : ''
      const motivo = String(m.endedReason ?? '')

      // O Vapi descreve o fim da chamada em texto; estas são as famílias que
      // importam para o motor.
      const naoAtendeu = /no-answer|busy|customer-did-not-answer|twilio-failed/i.test(motivo)
      const caixaPostal = /voicemail/i.test(motivo)

      const tipo: EventoRecebido['tipo'] = caixaPostal
        ? 'caixa_postal'
        : naoAtendeu
          ? 'nao_atendida'
          : ehPedidoDeParada(transcricao)
            ? 'optout'
            : 'atendida'

      return [
        {
          canal: 'ligacao',
          tipo,
          ...(provedorId ? { provedorId } : {}),
          ...(identificador ? { identificador } : {}),
          texto: transcricao,
          payload: {
            motivo,
            duracaoSegundos: Number(m.durationSeconds ?? 0),
            gravacaoUrl: m.recordingUrl ?? null,
            resumo: m.summary ?? null,
          },
        },
      ]
    },
  }
}
