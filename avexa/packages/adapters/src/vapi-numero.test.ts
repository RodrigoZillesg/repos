import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { garantirNumeroNaVapi } from './vapi.ts'

/** Importar o mesmo número duas vezes.
 *
 *  Número custa um mês inteiro a cada compra, sem proporcional. Testar de
 *  verdade significa reusar o mesmo número em vários clientes de teste
 *  seguidos, e isso só funciona se a importação na Vapi for idempotente: ela
 *  recusa um número que já está na conta, e o segundo ciclo falharia no mesmo
 *  passo em que o primeiro passou. */

const cred = (buscar: typeof fetch) => ({ apiKey: 'k', buscar })

const resposta = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } })

test('número ainda não importado é criado', async () => {
  const chamadas: string[] = []
  const buscar: typeof fetch = async (url, init) => {
    const metodo = init?.method ?? 'POST'
    chamadas.push(`${metodo} ${String(url).split('/').pop()}`)
    if (metodo === 'GET') return resposta([])
    return resposta({ id: 'pn-novo' })
  }

  const r = await garantirNumeroNaVapi(cred(buscar), {
    e164: '+61468096362',
    twilioAccountSid: 'AC',
    twilioAuthToken: 't',
    assistantId: 'a1',
  })

  assert.equal(r.ok && r.id, 'pn-novo')
  assert.deepEqual(chamadas, ['GET phone-number', 'POST phone-number'])
})

test('número já importado é reaproveitado e reapontado, não recriado', async () => {
  // O caso do segundo teste com o mesmo número. Recriar devolveria erro da
  // Vapi; não reapontar deixaria o número atendendo com o agente do cliente
  // anterior, que é pior: responde, e responde errado.
  const chamadas: string[] = []
  const buscar: typeof fetch = async (url, init) => {
    const metodo = init?.method ?? 'POST'
    chamadas.push(metodo)
    if (metodo === 'GET') return resposta([{ id: 'pn-velho', number: '+61468096362' }])
    return resposta({})
  }

  const r = await garantirNumeroNaVapi(cred(buscar), {
    e164: '+61468096362',
    twilioAccountSid: 'AC',
    twilioAuthToken: 't',
    assistantId: 'a2',
  })

  assert.equal(r.ok && r.id, 'pn-velho')
  assert.deepEqual(chamadas, ['GET', 'PATCH'], 'reaponta com PATCH, sem POST')
})

test('sem assistente, o número existente é devolvido sem reapontar nada', async () => {
  const chamadas: string[] = []
  const buscar: typeof fetch = async (url, init) => {
    chamadas.push(init?.method ?? 'POST')
    return resposta([{ id: 'pn-velho', number: '+61468096362' }])
  }

  const r = await garantirNumeroNaVapi(cred(buscar), {
    e164: '+61468096362',
    twilioAccountSid: 'AC',
    twilioAuthToken: 't',
  })

  assert.equal(r.ok && r.id, 'pn-velho')
  assert.deepEqual(chamadas, ['GET'])
})

test('falha ao listar não vira "não existe": seria importar em duplicata', async () => {
  const buscar: typeof fetch = async () => resposta({ message: 'boom' }, 500)
  const r = await garantirNumeroNaVapi(cred(buscar), {
    e164: '+61468096362',
    twilioAccountSid: 'AC',
    twilioAuthToken: 't',
  })
  assert.equal(r.ok, false)
})
