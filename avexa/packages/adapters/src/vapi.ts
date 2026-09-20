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

/* ------------------------------------------------------------------------ *
 * Gestão de assistentes e números na Vapi.
 *
 * Cada cliente tem o seu agente e o seu número. A configuração mora no Avexa
 * e é espelhada aqui — nunca o contrário.
 * ------------------------------------------------------------------------ */

export interface CredenciaisVapi {
  apiKey: string
  buscar?: Buscar
}

/** O que define um assistente, no formato da Vapi.
 *
 *  Campos escolhidos a partir de um agente real da conta, não do que a
 *  documentação sugere. `firstMessage` é irmão do prompt de propósito: no
 *  agente que inspecionamos os dois divergiam, e um se dizia obrigatório. */
export interface AssistenteVapi {
  nome: string
  modeloProvedor: string
  modelo: string
  prompt: string
  primeiraMensagem: string
  mensagemEncerramento: string
  mensagemCaixaPostal?: string | null
  provedorVoz: string
  vozId: string
  modeloVoz?: string | null
  transcritor: string
  modeloTranscritor?: string | null
  /** ISO curto: en, pt, es. Vai para o transcritor. */
  idioma: string
  /** Para onde a Vapi manda fim de chamada, transcrição e desfecho.
   *  Sem isto os eventos não chegam ao Avexa, e o opt-out dito em voz alta
   *  não entra na supressão global. */
  webhook?: string | null
  ajustes?: Record<string, unknown>
}

export type ResultadoAssistente =
  | { ok: true; id: string }
  | { ok: false; erro: string }

const urlVapi = (caminho: string) => `https://api.vapi.ai${caminho}`

const autorizacaoVapi = (c: CredenciaisVapi) => ({ authorization: `Bearer ${c.apiKey}` })

/** Os desfechos que o motor precisa ver de forma estruturada.
 *
 *  O agente que inspecionamos definia sete desfechos no texto do prompt e
 *  tinha `analysisPlan` desligado — ou seja, nada os capturava, e eles só
 *  existiam soltos na transcrição. Aqui eles viram saída estruturada, que é
 *  o que permite contar, filtrar e mostrar numa tela. */
export const DESFECHOS_LIGACAO = [
  'aceitou',
  'recusou',
  'sem_resposta',
  'caixa_postal',
  'segmento_errado',
  'optout',
  'reuniao_marcada',
] as const

function corpoDoAssistente(a: AssistenteVapi): Record<string, unknown> {
  return {
    name: a.nome,
    model: {
      provider: a.modeloProvedor,
      model: a.modelo,
      messages: [{ role: 'system', content: a.prompt }],
    },
    voice: {
      provider: a.provedorVoz,
      voiceId: a.vozId,
      ...(a.modeloVoz ? { model: a.modeloVoz } : {}),
    },
    transcriber: {
      provider: a.transcritor,
      ...(a.modeloTranscritor ? { model: a.modeloTranscritor } : {}),
      language: a.idioma,
    },
    firstMessage: a.primeiraMensagem,
    endCallMessage: a.mensagemEncerramento,
    endCallFunctionEnabled: true,
    dialKeypadFunctionEnabled: true,
    ...(a.mensagemCaixaPostal ? { voicemailMessage: a.mensagemCaixaPostal } : {}),
    // Detecção nativa: uma dependência externa a menos que pode falhar no
    // meio de uma ligação.
    voicemailDetection: { provider: 'vapi' },
    // Resumo e desfecho estruturados. Sem isto o que a ligação produziu só
    // existe como texto na transcrição.
    analysisPlan: {
      summaryPlan: { enabled: true },
      structuredDataPlan: {
        enabled: true,
        schema: {
          type: 'object',
          properties: {
            desfecho: { type: 'string', enum: [...DESFECHOS_LIGACAO] },
            motivo: { type: 'string' },
            emailConfirmado: { type: 'string' },
          },
          required: ['desfecho'],
        },
      },
    },
    ...(a.webhook ? { server: { url: a.webhook, timeoutSeconds: 20 } } : {}),
    ...(a.ajustes ?? {}),
  }
}

export async function criarAssistente(
  cred: CredenciaisVapi,
  a: AssistenteVapi,
): Promise<ResultadoAssistente> {
  const r = await requisitar(urlVapi('/assistant'), {
    cabecalhos: autorizacaoVapi(cred),
    corpo: corpoDoAssistente(a),
    ...(cred.buscar ? { buscar: cred.buscar } : {}),
  })
  if (!r.ok) return { ok: false, erro: r.erro ?? 'falha ao criar o assistente' }

  const id = (r.corpo as { id?: string } | null)?.id
  return id ? { ok: true, id } : { ok: false, erro: 'a Vapi não devolveu o id do assistente' }
}

export async function atualizarAssistente(
  cred: CredenciaisVapi,
  id: string,
  a: AssistenteVapi,
): Promise<ResultadoAssistente> {
  const r = await requisitar(urlVapi(`/assistant/${id}`), {
    metodo: 'PATCH',
    cabecalhos: autorizacaoVapi(cred),
    corpo: corpoDoAssistente(a),
    ...(cred.buscar ? { buscar: cred.buscar } : {}),
  })
  return r.ok ? { ok: true, id } : { ok: false, erro: r.erro ?? 'falha ao atualizar o assistente' }
}

export interface ImportacaoDeNumero {
  e164: string
  twilioAccountSid: string
  twilioAuthToken: string
  /** Vincula já na importação. O número sem assistente não atende ninguém. */
  assistantId?: string
  apelido?: string
}

/** Traz um número do Twilio para a Vapi.
 *
 *  Comprar no Twilio não basta para voz: a Vapi identifica número por id
 *  próprio, e é esse id que o motor usa para ligar. São dois passos. */
export async function importarNumeroNaVapi(
  cred: CredenciaisVapi,
  i: ImportacaoDeNumero,
): Promise<ResultadoAssistente> {
  const r = await requisitar(urlVapi('/phone-number'), {
    cabecalhos: autorizacaoVapi(cred),
    corpo: {
      provider: 'twilio',
      number: i.e164,
      twilioAccountSid: i.twilioAccountSid,
      twilioAuthToken: i.twilioAuthToken,
      ...(i.assistantId ? { assistantId: i.assistantId } : {}),
      ...(i.apelido ? { name: i.apelido } : {}),
    },
    ...(cred.buscar ? { buscar: cred.buscar } : {}),
  })
  if (!r.ok) return { ok: false, erro: r.erro ?? 'falha ao importar o número' }

  const id = (r.corpo as { id?: string } | null)?.id
  return id ? { ok: true, id } : { ok: false, erro: 'a Vapi não devolveu o id do número' }
}

/** Liga um assistente a um número já importado. */
export async function vincularAssistenteAoNumero(
  cred: CredenciaisVapi,
  numeroId: string,
  assistantId: string,
): Promise<{ ok: boolean; erro?: string }> {
  const r = await requisitar(urlVapi(`/phone-number/${numeroId}`), {
    metodo: 'PATCH',
    cabecalhos: autorizacaoVapi(cred),
    corpo: { assistantId },
    ...(cred.buscar ? { buscar: cred.buscar } : {}),
  })
  return r.ok ? { ok: true } : { ok: false, erro: r.erro ?? 'falha ao vincular o assistente' }
}
