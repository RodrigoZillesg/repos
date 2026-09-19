import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { buscarNumerosDisponiveis, comprarNumero, apontarWebhookSms } from './twilio.ts'

const CRED = { accountSid: 'ACxxx', authToken: 'tok' }

/** Twilio de mentira: guarda o que foi pedido, devolve o que mandarmos. */
function falso(resposta: unknown, status = 200) {
  const chamadas: Array<{ url: string; metodo: string; corpo: string | null }> = []
  const buscar = (async (url: string, init: RequestInit = {}) => {
    chamadas.push({
      url: String(url),
      metodo: init.method ?? 'GET',
      corpo: (init.body as string) ?? null,
    })
    return new Response(JSON.stringify(resposta), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  }) as unknown as typeof fetch
  return { buscar, chamadas }
}

const DISPONIVEIS = {
  available_phone_numbers: [
    {
      phone_number: '+61255500101',
      friendly_name: '+61 2 5550 0101',
      region: 'NSW',
      locality: 'Sydney',
      capabilities: { voice: true, SMS: true, MMS: true },
    },
  ],
}

test('a busca pede número com voz e SMS, no país certo', async () => {
  const f = falso(DISPONIVEIS)
  const r = await buscarNumerosDisponiveis({ ...CRED, buscar: f.buscar }, { pais: 'au' })

  assert.equal(r.ok, true)
  const url = f.chamadas[0]!.url
  // O país vai maiúsculo na URL: o Twilio recusa 'au'.
  assert.match(url, /AvailablePhoneNumbers\/AU\/Local\.json/)
  assert.match(url, /VoiceEnabled=true/)
  assert.match(url, /SmsEnabled=true/)
  assert.equal(f.chamadas[0]!.metodo, 'GET')
})

test('a busca traduz as capacidades do Twilio', async () => {
  const f = falso(DISPONIVEIS)
  const r = await buscarNumerosDisponiveis({ ...CRED, buscar: f.buscar }, { pais: 'AU' })
  assert.ok(r.ok)
  assert.deepEqual(r.numeros[0]!.capacidades, ['voz', 'sms'])
  assert.equal(r.numeros[0]!.locality, 'Sydney')
})

test('a compra configura o webhook junto: número sem webhook perde opt-out', async () => {
  const f = falso({
    sid: 'PN123',
    phone_number: '+61255500101',
    capabilities: { voice: true, SMS: true },
  })

  const r = await comprarNumero(
    { ...CRED, buscar: f.buscar },
    {
      e164: '+61255500101',
      webhookSms: 'https://new.avexa.global/api/webhooks/sms',
      apelido: 'Avexa · lbird',
    },
  )

  assert.ok(r.ok)
  assert.equal(r.numero.sid, 'PN123')

  const corpo = new URLSearchParams(f.chamadas[0]!.corpo ?? '')
  assert.equal(corpo.get('PhoneNumber'), '+61255500101')
  assert.equal(corpo.get('SmsUrl'), 'https://new.avexa.global/api/webhooks/sms')
  assert.equal(corpo.get('SmsMethod'), 'POST')
  assert.equal(corpo.get('FriendlyName'), 'Avexa · lbird')
})

test('compra sem SID de volta é falha, não sucesso silencioso', async () => {
  // Já gastamos dinheiro; sem SID não dá para reapontar o webhook depois, e
  // tratar isso como sucesso esconderia um número órfão.
  const f = falso({ phone_number: '+61255500101' })
  const r = await comprarNumero({ ...CRED, buscar: f.buscar }, { e164: '+61255500101' })
  assert.equal(r.ok, false)
  assert.ok(!r.ok && r.erro.includes('SID'))
})

test('erro do Twilio na compra vira falha com motivo', async () => {
  const f = falso({ message: 'Number is no longer available' }, 400)
  const r = await comprarNumero({ ...CRED, buscar: f.buscar }, { e164: '+61255500101' })
  assert.equal(r.ok, false)
})

test('reapontar o webhook usa o SID e manda só o que muda', async () => {
  const f = falso({ sid: 'PN123' })
  const r = await apontarWebhookSms(
    { ...CRED, buscar: f.buscar },
    'PN123',
    'https://new.avexa.global/api/webhooks/sms',
  )

  assert.equal(r.ok, true)
  assert.match(f.chamadas[0]!.url, /IncomingPhoneNumbers\/PN123\.json/)
  const corpo = new URLSearchParams(f.chamadas[0]!.corpo ?? '')
  assert.equal(corpo.get('SmsUrl'), 'https://new.avexa.global/api/webhooks/sms')
  assert.equal(corpo.get('PhoneNumber'), null)
})
