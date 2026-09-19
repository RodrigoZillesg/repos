import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { chaveDedupe, normalizarEmail, normalizarTelefone } from './normalizar.ts'

test('o mesmo número australiano escrito de várias formas dá a mesma chave', () => {
  const esperado = '+61412345678'
  for (const forma of [
    '0412 345 678',
    '0412345678',
    '+61 412 345 678',
    '+61412345678',
    '(04) 1234 5678',
    '0412-345-678',
    '0061412345678',
    '61412345678',
  ]) {
    assert.equal(normalizarTelefone(forma, 'AU'), esperado, forma)
  }
})

test('normaliza números dos Estados Unidos e do Brasil', () => {
  assert.equal(normalizarTelefone('(415) 555-2671', 'US'), '+14155552671')
  assert.equal(normalizarTelefone('415-555-2671', 'US'), '+14155552671')
  assert.equal(normalizarTelefone('11 98765-4321', 'BR'), '+5511987654321')
  assert.equal(normalizarTelefone('(011) 98765-4321', 'BR'), '+5511987654321')
})

test('o país padrão só decide quando o número não é internacional', () => {
  // Número australiano completo continua australiano mesmo com padrão americano.
  assert.equal(normalizarTelefone('+61412345678', 'US'), '+61412345678')
})

test('descarta ramal sem estragar o número', () => {
  assert.equal(normalizarTelefone('0412345678 ext. 42', 'AU'), '+61412345678')
})

test('número que não dá para normalizar com segurança devolve null', () => {
  // Preferimos não contatar a contatar a pessoa errada.
  assert.equal(normalizarTelefone('12345', 'AU'), null)
  assert.equal(normalizarTelefone('', 'AU'), null)
  assert.equal(normalizarTelefone(null), null)
  assert.equal(normalizarTelefone('não informado', 'AU'), null)
})

test('e-mail normaliza por caixa e espaço, e nada além disso', () => {
  assert.equal(normalizarEmail('  Lead@Exemplo.COM '), 'lead@exemplo.com')
  // Sem inventar equivalência: ponto e +tag do Gmail são endereços distintos,
  // porque suprimir mais do que a pessoa pediu também é erro.
  assert.equal(normalizarEmail('a.b@gmail.com'), 'a.b@gmail.com')
  assert.equal(normalizarEmail('a+promo@gmail.com'), 'a+promo@gmail.com')
})

test('e-mail malformado devolve null', () => {
  for (const ruim of ['sem-arroba', 'a@b', 'a@@b.com', '', '   ', null]) {
    assert.equal(normalizarEmail(ruim), null, String(ruim))
  }
})

test('a chave de dedupe prefere telefone a e-mail', () => {
  assert.equal(chaveDedupe('c1', 'f1', '+61412345678', 'a@b.com'), 'c1:f1:+61412345678')
  assert.equal(chaveDedupe('c1', 'f1', null, 'a@b.com'), 'c1:f1:a@b.com')
})
