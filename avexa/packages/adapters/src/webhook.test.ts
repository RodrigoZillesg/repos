import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  assinarSaida,
  conferirAssinaturaSaida,
  entregarWebhook,
  lerCabecalhos,
} from './webhook.ts'

interface Chamada {
  url: string
  init: RequestInit
}

function fetchFalso(respostas: Array<{ status?: number; erroDeRede?: boolean }>) {
  const chamadas: Chamada[] = []
  let i = 0
  const buscar = (async (url: string | URL | Request, init?: RequestInit) => {
    chamadas.push({ url: String(url), init: init ?? {} })
    const r = respostas[Math.min(i++, respostas.length - 1)] ?? {}
    if (r.erroDeRede) throw new Error('socket hang up')
    const status = r.status ?? 200
    return { ok: status < 300, status, text: async () => '{}' } as Response
  }) as typeof fetch
  return { buscar, chamadas }
}

const semEspera = async () => {}

const cab = (c: Chamada, nome: string) =>
  (c.init.headers as Record<string, string> | undefined)?.[nome]

test('a assinatura confere contra o corpo que saiu', async () => {
  const f = fetchFalso([{ status: 200 }])
  await entregarWebhook({
    url: 'https://cliente.com/avexa',
    corpo: { lead: { nome: 'Ana' } },
    segredo: 'whsec_teste',
    entregaId: 'e-1',
    buscar: f.buscar,
    esperar: semEspera,
  })

  const c = f.chamadas[0]!
  const corpoEnviado = String(c.init.body)
  assert.equal(
    conferirAssinaturaSaida(cab(c, 'x-avexa-assinatura'), corpoEnviado, 'whsec_teste'),
    true,
  )
})

test('reserializar o corpo quebra a assinatura, como tem de ser', () => {
  const corpo = JSON.stringify({ a: 1, b: 2 })
  const assinatura = assinarSaida('whsec_teste', corpo)
  const outro = JSON.stringify(JSON.parse(corpo), null, 2)
  assert.equal(conferirAssinaturaSaida(assinatura, corpo, 'whsec_teste'), true)
  assert.equal(conferirAssinaturaSaida(assinatura, outro, 'whsec_teste'), false)
})

test('segredo errado não confere, e um t velho é replay', () => {
  const corpo = '{"a":1}'
  assert.equal(conferirAssinaturaSaida(assinarSaida('certo', corpo), corpo, 'errado'), false)
  const velha = assinarSaida('certo', corpo, Math.floor(Date.now() / 1000) - 3600)
  assert.equal(conferirAssinaturaSaida(velha, corpo, 'certo'), false)
})

test('sem segredo, sai sem assinatura em vez de sair com uma vazia', async () => {
  const f = fetchFalso([{ status: 200 }])
  await entregarWebhook({
    url: 'https://cliente.com/avexa',
    corpo: {},
    entregaId: 'e-2',
    buscar: f.buscar,
    esperar: semEspera,
  })
  assert.equal(cab(f.chamadas[0]!, 'x-avexa-assinatura'), undefined)
})

test('o id de entrega é o mesmo em todas as tentativas — é o que evita lead duplicado', async () => {
  const f = fetchFalso([{ status: 500 }, { status: 500 }, { status: 200 }])
  const r = await entregarWebhook({
    url: 'https://cliente.com/avexa',
    corpo: {},
    entregaId: 'e-3',
    tentativas: 3,
    buscar: f.buscar,
    esperar: semEspera,
  })

  assert.equal(r.ok, true)
  assert.equal(r.tentativas, 3)
  assert.deepEqual(
    f.chamadas.map((c) => cab(c, 'x-avexa-entrega')),
    ['e-3', 'e-3', 'e-3'],
  )
  assert.deepEqual(
    f.chamadas.map((c) => cab(c, 'x-avexa-tentativa')),
    ['1', '2', '3'],
  )
})

test('cada tentativa assina de novo: a assinatura velha viraria replay do lado do cliente', async () => {
  const f = fetchFalso([{ status: 503 }, { status: 200 }])
  await entregarWebhook({
    url: 'https://cliente.com/avexa',
    corpo: { x: 1 },
    segredo: 'whsec_teste',
    entregaId: 'e-4',
    tentativas: 2,
    buscar: f.buscar,
    esperar: semEspera,
  })
  for (const c of f.chamadas) {
    assert.equal(
      conferirAssinaturaSaida(cab(c, 'x-avexa-assinatura'), String(c.init.body), 'whsec_teste'),
      true,
    )
  }
})

test('400 não é reenviado: insistir num erro do cliente só gasta a cota dele', async () => {
  const f = fetchFalso([{ status: 400 }])
  const r = await entregarWebhook({
    url: 'https://cliente.com/avexa',
    corpo: {},
    entregaId: 'e-5',
    tentativas: 5,
    buscar: f.buscar,
    esperar: semEspera,
  })
  assert.equal(r.ok, false)
  assert.equal(r.status, 400)
  assert.equal(f.chamadas.length, 1)
})

test('falha de rede é passageira e volta a tentar', async () => {
  const f = fetchFalso([{ erroDeRede: true }, { status: 200 }])
  const r = await entregarWebhook({
    url: 'https://cliente.com/avexa',
    corpo: {},
    entregaId: 'e-6',
    tentativas: 3,
    buscar: f.buscar,
    esperar: semEspera,
  })
  assert.equal(r.ok, true)
  assert.equal(r.tentativas, 2)
})

test('esgotar as tentativas devolve a última falha, não uma exceção', async () => {
  const f = fetchFalso([{ status: 500 }])
  const r = await entregarWebhook({
    url: 'https://cliente.com/avexa',
    corpo: {},
    entregaId: 'e-7',
    tentativas: 3,
    buscar: f.buscar,
    esperar: semEspera,
  })
  assert.equal(r.ok, false)
  assert.equal(r.tentativas, 3)
  assert.match(r.erro ?? '', /500/)
})

test('cabeçalho do operador entra, mas não sobrescreve a assinatura', () => {
  const c = lerCabecalhos('Authorization: Bearer abc\nX-Avexa-Assinatura: forjada\nvazio')
  assert.deepEqual(c, { Authorization: 'Bearer abc' })
})
