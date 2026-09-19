import { strict as assert } from 'node:assert'
import { test } from 'node:test'

process.env.APP_SECRET = 'uma-chave-de-teste-com-mais-de-32-caracteres'
const { assinar, cifrar, conferirAssinatura, decifrar } = await import('./cripto.ts')

test('o ciclo cifrar/decifrar devolve o segredo', () => {
  const token = '1//0abcDEF-refresh-token-do-google'
  const cifrado = cifrar(token, 'cliente-1:google_calendar')
  assert.notEqual(cifrado, token)
  assert.equal(cifrado.includes(token), false)
  assert.equal(decifrar(cifrado, 'cliente-1:google_calendar'), token)
})

test('o mesmo segredo cifra diferente a cada vez', () => {
  // Sem isso, dois clientes com o mesmo token teriam a mesma linha no banco, e
  // dava para descobrir isso só olhando.
  const a = cifrar('segredo', 'x')
  const b = cifrar('segredo', 'x')
  assert.notEqual(a, b)
  assert.equal(decifrar(a, 'x'), decifrar(b, 'x'))
})

test('um segredo movido para outro cliente não decifra', () => {
  const cifrado = cifrar('token', 'cliente-1:google_calendar')
  assert.equal(decifrar(cifrado, 'cliente-2:google_calendar'), null)
  assert.equal(decifrar(cifrado, 'cliente-1:google_sheets'), null)
})

test('texto adulterado devolve null em vez de lixo', () => {
  const cifrado = cifrar('token', 'x')
  const partes = cifrado.split('.')
  const mexido = [partes[0], partes[1], partes[2], Buffer.from('outra coisa').toString('base64url')].join('.')
  assert.equal(decifrar(mexido, 'x'), null)
})

test('decifrar nunca lança: integração quebrada não derruba o fluxo do lead', () => {
  for (const ruim of [null, undefined, '', 'nao-e-cifrado', 'v9.a.b.c', 'v1.a.b']) {
    assert.equal(decifrar(ruim, 'x'), null, String(ruim))
  }
})

test('assinatura de state protege o retorno do OAuth', () => {
  const estado = JSON.stringify({ clienteId: 'c1', tipo: 'google_calendar' })
  const assinado = assinar(estado)
  assert.equal(conferirAssinatura(assinado), estado)
  // Trocar o corpo sem refazer o MAC não passa — é o que impede alguém de
  // conectar a própria conta Google ao cliente de outra pessoa.
  const [, mac] = assinado.split('.')
  const forjado = `${Buffer.from('{"clienteId":"outro"}').toString('base64url')}.${mac}`
  assert.equal(conferirAssinatura(forjado), null)
  assert.equal(conferirAssinatura('lixo'), null)
  assert.equal(conferirAssinatura(null), null)
})

test('sem APP_SECRET, cifrar falha em vez de gravar em claro', async () => {
  const antes = process.env.APP_SECRET
  process.env.APP_SECRET = 'curta'
  assert.throws(() => cifrar('x', 'y'), /APP_SECRET/)
  process.env.APP_SECRET = antes
})
