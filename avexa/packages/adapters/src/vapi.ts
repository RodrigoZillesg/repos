import { createHmac, timingSafeEqual } from 'node:crypto'
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
  /** Segredo que a Vapi devolve em `x-vapi-secret` a cada POST.
   *
   *  Sem ele o endpoint aceita relatório de qualquer um — e um relatório
   *  forjado com `desfecho: optout` põe o número de um lead real na supressão
   *  GLOBAL, calando todos os canais com ele para sempre. */
  segredoWebhook?: string
  /** Assistente de reserva. O normal é o do cliente, que vem na intenção. */
  assistantId?: string
  /** Número de reserva na Vapi. O normal é o do cliente. */
  phoneNumberId?: string
  buscar?: Buscar
}

/** Como cada desfecho do agente vira evento do motor.
 *
 *  `optout` é o que mais importa: é ele que põe a pessoa na supressão global,
 *  em todos os canais. Por isso vem do modelo, que sabe quem disse o quê, e
 *  não de varredura de palavra sobre a transcrição inteira — que inclui o que
 *  o próprio agente falou. */
const DESFECHO_PARA_EVENTO = {
  aceitou: 'atendida',
  recusou: 'atendida',
  reuniao_marcada: 'atendida',
  segmento_errado: 'atendida',
  sem_resposta: 'nao_atendida',
  caixa_postal: 'caixa_postal',
  optout: 'optout',
} as const satisfies Record<string, EventoRecebido['tipo']>

type Desfecho = keyof typeof DESFECHO_PARA_EVENTO

function analise(m: Record<string, unknown>): Record<string, unknown> {
  const a = (m.analysis ?? {}) as Record<string, unknown>
  return (a.structuredData ?? {}) as Record<string, unknown>
}

/** O desfecho, só se for um dos que pedimos. Valor fora da lista é ruído do
 *  modelo, e tratá-lo como desconhecido é melhor que adivinhar. */
function lerDesfecho(m: Record<string, unknown>): Desfecho | null {
  const v = analise(m).desfecho
  return typeof v === 'string' && v in DESFECHO_PARA_EVENTO ? (v as Desfecho) : null
}

function lerTexto(m: Record<string, unknown>, chave: string): string | null {
  const v = analise(m)[chave]
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

/** O segredo compartilhado com a Vapi, derivado do APP_SECRET.
 *
 *  Derivado em vez de ser um segredo novo: um a menos para cadastrar, girar e
 *  esquecer. Vive aqui, e não em @avexa/servicos, porque quem publica o agente
 *  e quem confere o webhook precisam chegar ao MESMO valor — e derivar a mesma
 *  coisa em dois lugares é como se elas param de bater sem ninguém notar. */
export function segredoDoWebhookVapi(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const base = env.APP_SECRET
  if (!base || base.length < 32) return null
  return createHmac('sha256', base).update('vapi:webhook:v1').digest('hex')
}

/** Comparação em tempo constante. Comparar com === vaza, pelo tempo, quantos
 *  bytes iniciais o atacante acertou. */
function conferirSegredoVapi(recebido?: string, esperado?: string): boolean {
  // Sem segredo configurado nada é aceito: é o estado de um agente publicado
  // antes desta checagem existir, e aceitar seria manter a brecha aberta
  // justamente onde ninguém olharia.
  if (!esperado || !recebido) return false
  const a = Buffer.from(esperado)
  const b = Buffer.from(recebido)
  return a.length === b.length && timingSafeEqual(a, b)
}

const AVISO_GRAVACAO =
  'This call is recorded for quality and training purposes. / Esta chamada é gravada para fins de qualidade e treinamento.'

export function adaptadorVapi(cfg: ConfigVapi): AdaptadorCanal {
  return {
    canal: 'ligacao',
    provedor: 'vapi',

    async enviar(i: IntencaoContato): Promise<ResultadoEnvio> {
      const assistente = (i.opcoes?.assistantId as string) ?? cfg.assistantId
      const numeroId = (i.opcoes?.phoneNumberId as string) ?? cfg.phoneNumberId
      if (!assistente || !numeroId) {
        // A Vapi devolveria um 400 obscuro. Melhor dizer o que falta, e não
        // insistir: nenhuma retentativa cria um agente.
        return {
          ok: false,
          erro: !assistente
            ? 'sem agente de voz: este cliente não tem agente publicado na Vapi'
            : 'sem número na Vapi: o número do cliente ainda não foi importado',
          reenviavel: false,
        }
      }

      const r = await requisitar('https://api.vapi.ai/call', {
        cabecalhos: { authorization: `Bearer ${cfg.apiKey}` },
        corpo: {
          assistantId: assistente,
          phoneNumberId: numeroId,
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

    interpretarWebhook(corpo: unknown, cabecalhos: Record<string, string>): EventoRecebido[] {
      // Antes de olhar o conteúdo: veio mesmo da Vapi? O relatório decide
      // supressão global, e supressão forjada é definitiva na prática.
      if (!conferirSegredoVapi(cabecalhos['x-vapi-secret'], cfg.segredoWebhook)) return []

      const m = (corpo as { message?: Record<string, unknown> } | null)?.message
      if (!m || m.type !== 'end-of-call-report') return []

      const chamada = (m.call ?? {}) as Record<string, unknown>
      const provedorId = typeof chamada.id === 'string' ? chamada.id : undefined
      const cliente = (chamada.customer ?? {}) as { number?: string }
      const identificador = normalizarTelefone(cliente.number ?? null, 'US') ?? undefined
      const transcricao = typeof m.transcript === 'string' ? m.transcript : ''
      const motivo = String(m.endedReason ?? '')

      // O Vapi descreve o fim da chamada em texto; estas são as famílias que
      // importam para o motor. Vêm primeiro porque são verdade mecânica: se
      // ninguém atendeu, não há conversa sobre a qual opinar.
      const naoAtendeu = /no-answer|busy|customer-did-not-answer|twilio-failed/i.test(motivo)
      const caixaPostal = /voicemail/i.test(motivo)

      const desfecho = lerDesfecho(m)

      const tipo: EventoRecebido['tipo'] = caixaPostal
        ? 'caixa_postal'
        : naoAtendeu
          ? 'nao_atendida'
          : desfecho
            ? DESFECHO_PARA_EVENTO[desfecho]
            : // Só quando o agente não devolveu desfecho estruturado — agente
              // antigo, ou análise que falhou. A heurística foi feita para SMS
              // de três palavras; sobre a transcrição inteira de uma conversa
              // ela erra para o lado perigoso. "não quero mais falar disso
              // agora, me liga semana que vem" vira opt-out global, e o lead
              // que pediu retorno nunca mais é contatado por canal nenhum.
              ehPedidoDeParada(transcricao)
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
            desfecho: desfecho ?? null,
            // Quando o desfecho veio do modelo, o motivo dele vale mais que
            // qualquer inferência nossa sobre a transcrição.
            desfechoMotivo: lerTexto(m, 'motivo'),
            emailConfirmado: lerTexto(m, 'emailConfirmado'),
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
  /** Segredo que a Vapi devolve no cabeçalho a cada POST. Sem ele o endpoint
   *  aceitaria um relatório forjado — e desfecho forjado vira supressão. */
  segredoWebhook?: string | null
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
    ...(a.webhook
      ? {
          server: {
            url: a.webhook,
            timeoutSeconds: 20,
            ...(a.segredoWebhook ? { secret: a.segredoWebhook } : {}),
          },
        }
      : {}),
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
/** Procura um número já importado na conta da Vapi, pelo E.164. */
export async function acharNumeroNaVapi(
  cred: CredenciaisVapi,
  e164: string,
): Promise<{ ok: true; id: string | null } | { ok: false; erro: string }> {
  const r = await requisitar(urlVapi('/phone-number'), {
    metodo: 'GET',
    cabecalhos: autorizacaoVapi(cred),
    ...(cred.buscar ? { buscar: cred.buscar } : {}),
  })
  if (!r.ok) return { ok: false, erro: r.erro ?? 'falha ao listar os números da Vapi' }

  const lista = Array.isArray(r.corpo) ? r.corpo : []
  const achado = lista.find((x) => (x as { number?: string }).number === e164)
  return { ok: true, id: (achado as { id?: string } | undefined)?.id ?? null }
}

/** Importa o número na Vapi, ou reaproveita o que já está lá.
 *
 *  Procurar antes não é otimização: a Vapi recusa importar um número que já
 *  está na conta, e o segundo ciclo de teste com o mesmo número falharia no
 *  mesmo passo em que o primeiro passou. Como número custa um mês inteiro a
 *  cada compra, testar de verdade significa reusar o mesmo número muitas
 *  vezes — e isso só funciona se importar for idempotente. */
export async function garantirNumeroNaVapi(
  cred: CredenciaisVapi,
  i: ImportacaoDeNumero,
): Promise<ResultadoAssistente> {
  const existente = await acharNumeroNaVapi(cred, i.e164)
  if (!existente.ok) return { ok: false, erro: existente.erro }

  if (existente.id) {
    // Já está lá: só reaponta para o assistente desta ativação. Sem isto, o
    // número continuaria atendendo com o agente do cliente anterior.
    if (i.assistantId) {
      const v = await vincularAssistenteAoNumero(cred, existente.id, i.assistantId)
      if (!v.ok) return { ok: false, erro: v.erro ?? 'falha ao reapontar o assistente' }
    }
    return { ok: true, id: existente.id }
  }

  return importarNumeroNaVapi(cred, i)
}

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
