import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { criarAdaptador, adaptadoresDoAmbiente } from './index.ts'
import { adaptadorResend } from './resend.ts'
import { adaptadorTwilioSms } from './twilio.ts'
import { adaptadorVapi } from './vapi.ts'
import { adaptadorWhatsApp } from './whatsapp.ts'
import { requisitar } from './http.ts'

/** fetch falso que guarda a chamada e devolve o que o teste mandar. */
function fetchFalso(resposta: { status?: number; corpo?: unknown } = {}) {
  const chamadas: Array<{ url: string; init: RequestInit }> = []
  const buscar = (async (url: string | URL | Request, init?: RequestInit) => {
    chamadas.push({ url: String(url), init: init ?? {} })
    const status = resposta.status ?? 200
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => JSON.stringify(resposta.corpo ?? {}),
    } as Response
  }) as typeof fetch
  return { buscar, chamadas }
}

const intencao = {
  tentativaId: 't-1',
  canal: 'email' as const,
  destinatario: 'lead@exemplo.com',
}

test('Resend envia do domínio da Avexa e carrega o id da tentativa', async () => {
  const f = fetchFalso({ corpo: { id: 're_123' } })
  const a = adaptadorResend({
    apiKey: 'k',
    remetente: 'Avexa <contato@avexa.global>',
    buscar: f.buscar,
  })
  const r = await a.enviar({ ...intencao, assunto: 'Oi', texto: 'corpo', opcoes: { replyTo: 'time@cliente.com' } })

  assert.equal(r.ok, true)
  assert.equal(r.provedorId, 're_123')

  const corpo = JSON.parse(String(f.chamadas[0]!.init.body))
  assert.equal(corpo.from, 'Avexa <contato@avexa.global>')
  assert.equal(corpo.reply_to, 'time@cliente.com')
  // O id volta no webhook e liga o evento à tentativa sem depender de busca.
  assert.equal(corpo.headers['X-Avexa-Tentativa'], 't-1')
})

test('Resend traduz os webhooks de entrega, bounce e reclamação', () => {
  const a = adaptadorResend({ apiKey: 'k', remetente: 'x' })
  const ler = (type: string) =>
    a.interpretarWebhook!({ type, data: { email_id: 're_1', to: ['Lead@Exemplo.COM'] } }, {}) as ReturnType<
      NonNullable<typeof a.interpretarWebhook>
    >

  assert.equal((ler('email.delivered') as any)[0].tipo, 'entregue')
  assert.equal((ler('email.bounced') as any)[0].tipo, 'bounce')
  assert.equal((ler('email.complained') as any)[0].tipo, 'reclamacao')
  // O identificador sai normalizado, para casar com a supressão global.
  assert.equal((ler('email.delivered') as any)[0].identificador, 'lead@exemplo.com')
  assert.deepEqual(ler('email.qualquer'), [])
})

test('Twilio envia como formulário e usa Messaging Service quando o remetente é MG', async () => {
  const f = fetchFalso({ corpo: { sid: 'SM1' } })
  const a = adaptadorTwilioSms({
    accountSid: 'AC1',
    authToken: 'tok',
    remetente: 'MG123',
    buscar: f.buscar,
  })
  const r = await a.enviar({ ...intencao, canal: 'sms', destinatario: '+61412345678', texto: 'oi' })

  assert.equal(r.provedorId, 'SM1')
  const chamada = f.chamadas[0]!
  assert.equal(
    (chamada.init.headers as Record<string, string>)['content-type'],
    'application/x-www-form-urlencoded',
  )
  const corpo = new URLSearchParams(String(chamada.init.body))
  assert.equal(corpo.get('MessagingServiceSid'), 'MG123')
  assert.equal(corpo.get('From'), null)
})

test('um STOP recebido por SMS vira evento de opt-out', () => {
  const a = adaptadorTwilioSms({ accountSid: 'AC1', authToken: 't', remetente: '+15551234567' })
  const [e] = a.interpretarWebhook!({ MessageSid: 'SM2', From: '+61412345678', Body: 'STOP' }, {}) as any
  assert.equal(e.tipo, 'optout')
  assert.equal(e.identificador, '+61412345678')

  const [r] = a.interpretarWebhook!({ MessageSid: 'SM3', From: '+61412345678', Body: 'tenho interesse' }, {}) as any
  assert.equal(r.tipo, 'respondida')
})

test('WhatsApp manda template com as variáveis por posição', async () => {
  const f = fetchFalso({ corpo: { messages: [{ id: 'wamid.1' }] } })
  const a = adaptadorWhatsApp({ token: 'tok', phoneNumberId: '123', buscar: f.buscar })
  await a.enviar({
    ...intencao,
    canal: 'whatsapp',
    destinatario: '+61412345678',
    templateExterno: 'primeiro_contato',
    variaveis: { nome: 'Ana', curso: 'IELTS' },
    opcoes: { idioma: 'en' },
  })

  const corpo = JSON.parse(String(f.chamadas[0]!.init.body))
  assert.equal(corpo.type, 'template')
  assert.equal(corpo.template.name, 'primeiro_contato')
  assert.deepEqual(corpo.template.components[0].parameters, [
    { type: 'text', text: 'Ana' },
    { type: 'text', text: 'IELTS' },
  ])
})

test('fora da janela de 24h do WhatsApp não é erro para reenviar', async () => {
  // Reenviar não resolve: o fluxo é que precisa usar template. Marcar como
  // reenviável faria a tentativa girar na fila até estourar o limite.
  const f = fetchFalso({ status: 400, corpo: { error: { code: 131047, message: 'fora da janela' } } })
  const a = adaptadorWhatsApp({ token: 't', phoneNumberId: '1', buscar: f.buscar })
  const r = await a.enviar({ ...intencao, canal: 'whatsapp', destinatario: '+61412345678', texto: 'oi' })

  assert.equal(r.ok, false)
  assert.equal(r.reenviavel, false)
  assert.equal((r.detalhe as any).foraDaJanela, true)
})

test('WhatsApp lê status e mensagem recebida no mesmo webhook', () => {
  const a = adaptadorWhatsApp({ token: 't', phoneNumberId: '1' })
  const eventos = a.interpretarWebhook!(
    {
      entry: [
        {
          changes: [
            {
              value: {
                statuses: [{ id: 'wamid.1', status: 'read' }],
                messages: [{ from: '61412345678', text: { body: 'parar' } }],
              },
            },
          ],
        },
      ],
    },
    {},
  ) as any

  assert.equal(eventos.length, 2)
  assert.equal(eventos[0].tipo, 'lida')
  assert.equal(eventos[1].tipo, 'optout')
  assert.equal(eventos[1].identificador, '+61412345678')
})

test('Vapi anuncia a gravação na primeira fala, não numa configuração', async () => {
  const f = fetchFalso({ corpo: { id: 'call_1' } })
  const a = adaptadorVapi({ apiKey: 'k', assistantId: 'as1', phoneNumberId: 'pn1', buscar: f.buscar })
  await a.enviar({ ...intencao, canal: 'ligacao', destinatario: '+61412345678', texto: 'Olá!' })

  const corpo = JSON.parse(String(f.chamadas[0]!.init.body))
  assert.match(corpo.assistantOverrides.firstMessage, /recorded for quality/i)
  assert.equal(corpo.assistantOverrides.recordingEnabled, true)
  assert.equal(corpo.metadata.tentativaId, 't-1')
})

test('Vapi separa não atendida, caixa postal e chamada atendida', () => {
  const a = adaptadorVapi({ apiKey: 'k', assistantId: 'a', phoneNumberId: 'p' })
  const ler = (endedReason: string, transcript = '') =>
    (a.interpretarWebhook!(
      {
        message: {
          type: 'end-of-call-report',
          endedReason,
          transcript,
          durationSeconds: 42,
          call: { id: 'call_1', customer: { number: '+61412345678' } },
        },
      },
      {},
    ) as any)[0]

  assert.equal(ler('customer-did-not-answer').tipo, 'nao_atendida')
  assert.equal(ler('voicemail').tipo, 'caixa_postal')
  assert.equal(ler('customer-ended-call', 'Oi, tenho interesse').tipo, 'atendida')
  // Pedido de parada dito na ligação também entra na supressão global.
  assert.equal(ler('customer-ended-call', 'não me ligue mais por favor').tipo, 'optout')
})

test('o HTTP separa falha passageira de falha definitiva', async () => {
  const cenario = async (status: number) =>
    requisitar('https://x', { buscar: fetchFalso({ status }).buscar, corpo: {} })

  assert.equal((await cenario(429)).reenviavel, true)
  assert.equal((await cenario(503)).reenviavel, true)
  // Reenviar um 400 só gastaria cota.
  assert.equal((await cenario(400)).reenviavel, false)
  assert.equal((await cenario(401)).reenviavel, false)
})

test('falha de rede é passageira por definição', async () => {
  const buscar = (async () => {
    throw new Error('ECONNRESET')
  }) as typeof fetch
  const r = await requisitar('https://x', { buscar, corpo: {} })
  assert.equal(r.ok, false)
  assert.equal(r.reenviavel, true)
})

test('modo seco devolve o adaptador que registra e não envia', async () => {
  const a = criarAdaptador('whatsapp', {}, { seco: true })!
  assert.equal(a.provedor, 'dry-run')
  const r = await a.enviar({ ...intencao, canal: 'whatsapp', destinatario: '+61412345678' })
  assert.equal(r.ok, true)
  assert.equal((r.detalhe as any).dryRun, true)
})

test('canal sem credencial não entra no mapa e o motor pula a etapa', () => {
  const cfg = adaptadoresDoAmbiente({ RESEND_API_KEY: 'k' })
  assert.ok(cfg.email)
  assert.equal(cfg.sms, undefined)
  assert.equal(criarAdaptador('sms', cfg), null)
  assert.ok(criarAdaptador('email', cfg))
})

test('Telegram existe no domínio antes de existir adaptador', () => {
  // De propósito: acrescentar um canal não deve exigir migração de banco.
  assert.equal(criarAdaptador('telegram', adaptadoresDoAmbiente({})), null)
})
