import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { PERIODOS, periodoValido, variacao } from './resumo.ts'

/** O resumo é o que o cliente lê primeiro, e número errado aqui não dá erro:
 *  dá uma impressão. Estes testes cobrem as formas de mentir sem querer. */

test('o período vem da URL, então vem de qualquer um', () => {
  // Uma janela de 9999 dias varreria a base inteira a cada visita.
  assert.equal(periodoValido('9999'), 30)
  assert.equal(periodoValido('-1'), 30)
  assert.equal(periodoValido('abc'), 30)
  assert.equal(periodoValido(undefined), 30)
  assert.equal(periodoValido(null), 30)
})

test('os períodos oferecidos são aceitos, como texto ou número', () => {
  for (const p of PERIODOS) {
    assert.equal(periodoValido(String(p)), p)
    assert.equal(periodoValido(p), p)
  }
})

test('sem período anterior não há comparação: o primeiro mês não mostra nada', () => {
  // Senão o cliente novo veria "+100%" em tudo — ruído com cara de resultado.
  assert.deepEqual(variacao({ valor: 12, anterior: null }), { tipo: 'nenhuma' })
  assert.deepEqual(variacao({ valor: 0, anterior: null }), { tipo: 'nenhuma' })
})

test('de zero para três não é "+300%": é "+3"', () => {
  // Dividir por zero e arredondar produz um número que parece medido.
  const v = variacao({ valor: 3, anterior: 0 })
  assert.equal(v.tipo, 'delta')
  assert.equal(v.tipo === 'delta' && v.texto, '+3')
  assert.equal(v.tipo === 'delta' && v.subiu, true)
})

test('havendo base para dividir, o percentual aparece', () => {
  const v = variacao({ valor: 15, anterior: 10 })
  assert.equal(v.tipo === 'delta' && v.texto, '+50%')
})

test('queda vem com sinal escrito, não só com a cor', () => {
  // Quem não distingue as cores precisa ler a direção no texto.
  const v = variacao({ valor: 5, anterior: 10 })
  assert.equal(v.tipo === 'delta' && v.subiu, false)
  assert.equal(v.tipo === 'delta' && v.texto, '−50%')
})

test('número parado diz que está parado, em vez de sumir', () => {
  // Ausência de variação e ausência de comparação são coisas diferentes, e a
  // tela não pode mostrar as duas como espaço em branco.
  assert.deepEqual(variacao({ valor: 7, anterior: 7 }), { tipo: 'igual' })
  assert.deepEqual(variacao({ valor: 0, anterior: 0 }), { tipo: 'igual' })
})

test('cair para zero é uma queda de 100%, não uma ausência de dado', () => {
  const v = variacao({ valor: 0, anterior: 8 })
  assert.equal(v.tipo === 'delta' && v.texto, '−100%')
  assert.equal(v.tipo === 'delta' && v.subiu, false)
})
