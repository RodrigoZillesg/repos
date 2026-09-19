import { strict as assert } from 'node:assert'
import { createHmac } from 'node:crypto'
import { test } from 'node:test'
import { conferirAssinaturaTwilio } from './twilio.ts'

const TOKEN = '12345678901234567890123456789012'
const URL = 'https://new.avexa.global/api/webhooks/sms'

/** Assina como o Twilio assina, para o teste não repetir a implementação. */
const assinar = (url: string, p: Record<string, string>) =>
  createHmac('sha1', TOKEN)
    .update(url + Object.keys(p).sort().map((k) => k + p[k]).join(''), 'utf8')
    .digest('base64')

test('aceita um POST legítimo do Twilio', () => {
  const p = { From: '+61255500101', Body: 'quero saber o preço', MessageSid: 'SM1' }
  assert.equal(conferirAssinaturaTwilio(TOKEN, URL, p, assinar(URL, p)), true)
})

test('a ordem dos parâmetros não muda a assinatura', () => {
  const p = { Body: 'oi', From: '+61255500101' }
  const assinatura = assinar(URL, { From: '+61255500101', Body: 'oi' })
  assert.equal(conferirAssinaturaTwilio(TOKEN, URL, p, assinatura), true)
})

test('recusa um opt-out forjado: é o ataque que importa', () => {
  // Quem não tem o authToken não consegue assinar. Sem esta checagem, este
  // POST poria o número do lead na supressão global.
  const forjado = { From: '+61255500101', Body: 'STOP', MessageSid: 'SM1' }
  assert.equal(conferirAssinaturaTwilio(TOKEN, URL, forjado, 'YXNzaW5hdHVyYQ=='), false)
})

test('recusa corpo adulterado com assinatura válida de outro corpo', () => {
  const original = { From: '+61255500101', Body: 'oi' }
  const adulterado = { From: '+61255500101', Body: 'STOP' }
  assert.equal(conferirAssinaturaTwilio(TOKEN, URL, adulterado, assinar(URL, original)), false)
})

test('recusa assinatura válida para outra URL', () => {
  const p = { From: '+61255500101', Body: 'oi' }
  const deOutraUrl = assinar('https://outro.exemplo/api/webhooks/sms', p)
  assert.equal(conferirAssinaturaTwilio(TOKEN, URL, p, deOutraUrl), false)
})

test('recusa quando não vem assinatura nenhuma', () => {
  const p = { From: '+61255500101', Body: 'STOP' }
  assert.equal(conferirAssinaturaTwilio(TOKEN, URL, p, null), false)
  assert.equal(conferirAssinaturaTwilio(TOKEN, URL, p, ''), false)
})

test('sem authToken configurado, nada é aceito', () => {
  const p = { From: '+61255500101', Body: 'oi' }
  assert.equal(conferirAssinaturaTwilio('', URL, p, assinar(URL, p)), false)
})
