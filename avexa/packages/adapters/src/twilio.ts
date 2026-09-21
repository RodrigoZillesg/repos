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
  /** Remetente de reserva, em E.164 ou SID de Messaging Service.
   *
   *  Opcional de propósito: o normal é cada cliente falar do próprio número,
   *  que vem na intenção de contato. Isto aqui só cobre quem ainda não tem
   *  número atribuído. */
  remetente?: string
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
      if (!de) {
        // Sem número, o Twilio devolveria um 400 obscuro. Melhor dizer o que
        // realmente falta, e não insistir: nenhuma retentativa arruma isto.
        return {
          ok: false,
          erro: 'sem remetente: este cliente não tem número atribuído e não há remetente de reserva',
          reenviavel: false,
        }
      }
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

/* ------------------------------------------------------------------------ *
 * Provisionamento de números.
 *
 * O ponto do produto é comprar o número do cliente daqui, sem ninguém abrir o
 * console do Twilio. Cada cliente fala do próprio número: o lead reconhece
 * quem o procurou, e o SMS sai do mesmo número que liga.
 * ------------------------------------------------------------------------ */

export interface CredenciaisTwilio {
  accountSid: string
  authToken: string
  buscar?: Buscar
}

export interface NumeroDisponivel {
  e164: string
  amigavel: string
  regiao: string | null
  locality: string | null
  capacidades: string[]
}

export interface NumeroComprado {
  e164: string
  sid: string
  capacidades: string[]
}

export type ResultadoNumeros =
  | { ok: true; numeros: NumeroDisponivel[] }
  | { ok: false; erro: string }

export type ResultadoCompra = { ok: true; numero: NumeroComprado } | { ok: false; erro: string }

const autorizacao = (c: CredenciaisTwilio) => ({
  authorization: `Basic ${Buffer.from(`${c.accountSid}:${c.authToken}`).toString('base64')}`,
})

const base = (c: CredenciaisTwilio) =>
  `https://api.twilio.com/2010-04-01/Accounts/${c.accountSid}`

const capacidadesDe = (v: unknown): string[] => {
  const c = (v ?? {}) as Record<string, boolean>
  return [c.voice ? 'voz' : '', c.SMS || c.sms ? 'sms' : ''].filter(Boolean)
}

/** Tipos de número do Twilio.
 *
 *  Não é detalhe: na Austrália, número `Local` em geral NÃO manda SMS — quem
 *  manda é `Mobile`. Buscar só em Local devolve lista vazia e parece que não
 *  há número no país, quando na verdade se procurou no lugar errado. */
export type TipoDeNumero = 'Local' | 'Mobile' | 'TollFree'

export interface BuscaDeNumeros {
  /** ISO de dois caracteres: AU, US. */
  pais: string
  /** Padrão: Local. */
  tipo?: TipoDeNumero
  /** Exige voz além de SMS. Um número que só manda SMS não serve para o motor
   *  de voz, e descobrir isso na hora de ligar é tarde. */
  exigeVoz?: boolean
  /** Prefixo, DDD ou parte do número, no formato do Twilio. */
  contem?: string
  limite?: number
}

/** Lista números à venda no Twilio. Não compra nada e não custa nada. */
export async function buscarNumerosDisponiveis(
  cred: CredenciaisTwilio,
  b: BuscaDeNumeros,
): Promise<ResultadoNumeros> {
  const q = new URLSearchParams({
    SmsEnabled: 'true',
    PageSize: String(b.limite ?? 10),
    ...(b.exigeVoz !== false ? { VoiceEnabled: 'true' } : {}),
    ...(b.contem ? { Contains: b.contem } : {}),
  })

  const r = await requisitar(
    `${base(cred)}/AvailablePhoneNumbers/${b.pais.toUpperCase()}/${b.tipo ?? 'Local'}.json?${q}`,
    {
      metodo: 'GET',
      cabecalhos: autorizacao(cred),
      ...(cred.buscar ? { buscar: cred.buscar } : {}),
    },
  )

  if (!r.ok) return { ok: false, erro: r.erro ?? 'falha ao consultar números' }

  const lista = (r.corpo as { available_phone_numbers?: unknown[] } | null)
    ?.available_phone_numbers
  if (!Array.isArray(lista)) return { ok: false, erro: 'resposta do Twilio sem lista de números' }

  return {
    ok: true,
    numeros: lista.map((n) => {
      const x = n as Record<string, unknown>
      return {
        e164: String(x.phone_number ?? ''),
        amigavel: String(x.friendly_name ?? ''),
        regiao: (x.region as string) ?? null,
        locality: (x.locality as string) ?? null,
        capacidades: capacidadesDe(x.capabilities),
      }
    }),
  }
}

export interface CompraDeNumero {
  e164: string
  /** Para onde o Twilio manda resposta e opt-out do lead. Configurado na
   *  compra, e não depois, porque um número comprado sem webhook recebe
   *  mensagem e joga fora em silêncio. */
  webhookSms?: string
  /** Rótulo no console do Twilio. Sem isto vira uma lista de números sem dono. */
  apelido?: string
}

/** Compra um número. Isto gasta dinheiro de verdade, todo mês. */
export async function comprarNumero(
  cred: CredenciaisTwilio,
  c: CompraDeNumero,
): Promise<ResultadoCompra> {
  const corpo: Record<string, string> = { PhoneNumber: c.e164 }
  if (c.webhookSms) {
    corpo.SmsUrl = c.webhookSms
    corpo.SmsMethod = 'POST'
  }
  if (c.apelido) corpo.FriendlyName = c.apelido

  const r = await requisitar(`${base(cred)}/IncomingPhoneNumbers.json`, {
    cabecalhos: autorizacao(cred),
    corpo,
    formulario: true,
    ...(cred.buscar ? { buscar: cred.buscar } : {}),
  })

  if (!r.ok) return { ok: false, erro: r.erro ?? 'falha ao comprar o número' }

  const x = (r.corpo ?? {}) as Record<string, unknown>
  const sid = String(x.sid ?? '')
  if (!sid) return { ok: false, erro: 'o Twilio não devolveu o SID do número comprado' }

  return {
    ok: true,
    numero: {
      e164: String(x.phone_number ?? c.e164),
      sid,
      capacidades: capacidadesDe(x.capabilities),
    },
  }
}

/** Aponta (ou reaponta) o webhook de SMS de um número já comprado.
 *
 *  Serve para números comprados antes desta automação existir, e para quando o
 *  domínio mudar. */
export async function apontarWebhookSms(
  cred: CredenciaisTwilio,
  sid: string,
  webhookSms: string,
): Promise<{ ok: boolean; erro?: string }> {
  const r = await requisitar(`${base(cred)}/IncomingPhoneNumbers/${sid}.json`, {
    cabecalhos: autorizacao(cred),
    corpo: { SmsUrl: webhookSms, SmsMethod: 'POST' },
    formulario: true,
    ...(cred.buscar ? { buscar: cred.buscar } : {}),
  })
  return r.ok ? { ok: true } : { ok: false, erro: r.erro ?? 'falha ao apontar o webhook' }
}

/** Um número que a conta já possui, como o Twilio o vê.
 *
 *  `apelido` é o FriendlyName: é o único lugar onde está escrito de quem é o
 *  número. Sem ele a conta é uma coluna de dígitos, e a antiga já está assim. */
export interface NumeroDaConta {
  sid: string
  e164: string
  apelido: string
  capacidades: string[]
  /** Para onde o Twilio entrega SMS recebido. Vazio significa que a resposta e
   *  o opt-out do lead são recebidos e jogados fora sem aviso. */
  webhookSms: string | null
  webhookVoz: string | null
}

export type ResultadoInventario =
  | { ok: true; numeros: NumeroDaConta[] }
  | { ok: false; erro: string }

const numeroDaConta = (x: Record<string, unknown>): NumeroDaConta => ({
  sid: String(x.sid ?? ''),
  e164: String(x.phone_number ?? ''),
  apelido: String(x.friendly_name ?? ''),
  capacidades: capacidadesDe(x.capabilities),
  webhookSms: (x.sms_url as string) || null,
  webhookVoz: (x.voice_url as string) || null,
})

/** Lista os números que a conta JÁ possui. Só leitura, não custa nada.
 *
 *  Segue a paginação até o fim de propósito. O Twilio devolve 50 por página e
 *  um `next_page_uri`; parar na primeira página daria uma lista que parece
 *  completa e não é — e o sintoma seria comprar de novo um número que já se
 *  tem, ou não achar o número do cliente que reclamou. */
export async function listarNumerosDaConta(
  cred: CredenciaisTwilio,
  limitePaginas = 20,
): Promise<ResultadoInventario> {
  const numeros: NumeroDaConta[] = []
  let caminho: string | null = `/2010-04-01/Accounts/${cred.accountSid}/IncomingPhoneNumbers.json?PageSize=50`

  for (let pagina = 0; caminho && pagina < limitePaginas; pagina++) {
    const r = await requisitar(`https://api.twilio.com${caminho}`, {
      metodo: 'GET',
      cabecalhos: autorizacao(cred),
      ...(cred.buscar ? { buscar: cred.buscar } : {}),
    })
    if (!r.ok) return { ok: false, erro: r.erro ?? 'falha ao listar os números da conta' }

    const corpo = (r.corpo ?? {}) as { incoming_phone_numbers?: unknown[]; next_page_uri?: unknown }
    const lista = corpo.incoming_phone_numbers
    if (!Array.isArray(lista)) return { ok: false, erro: 'resposta do Twilio sem lista de números' }

    for (const n of lista) numeros.push(numeroDaConta(n as Record<string, unknown>))
    caminho = typeof corpo.next_page_uri === 'string' && corpo.next_page_uri ? corpo.next_page_uri : null
  }

  return { ok: true, numeros }
}

/** Troca o nome do número no Twilio.
 *
 *  O apelido é a única identificação que viaja com o número: ele aparece no
 *  console, na fatura e em qualquer ferramenta que leia a conta. Por isso vale
 *  a pena gravá-lo lá e não só no nosso banco — quem abre o Twilio às três da
 *  manhã para entender uma cobrança não tem a Avexa aberta do lado. */
export async function renomearNumero(
  cred: CredenciaisTwilio,
  sid: string,
  apelido: string,
): Promise<{ ok: boolean; erro?: string }> {
  const nome = apelido.trim()
  if (!nome) return { ok: false, erro: 'o apelido não pode ser vazio' }
  // O Twilio corta em 64 caracteres sem reclamar: o nome volta diferente do que
  // foi mandado e ninguém percebe. Melhor recusar do que gravar truncado.
  if (nome.length > 64) return { ok: false, erro: 'o apelido do Twilio cabe em 64 caracteres' }

  const r = await requisitar(`${base(cred)}/IncomingPhoneNumbers/${sid}.json`, {
    cabecalhos: autorizacao(cred),
    corpo: { FriendlyName: nome },
    formulario: true,
    ...(cred.buscar ? { buscar: cred.buscar } : {}),
  })
  return r.ok ? { ok: true } : { ok: false, erro: r.erro ?? 'falha ao renomear o número' }
}
