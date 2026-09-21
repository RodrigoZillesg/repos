import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  PERIODOS,
  cursorParaTexto,
  fronteiras,
  periodoValido,
  textoParaCursor,
  variacao,
} from './resumo.ts'

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

/* ------------------------------- Paginação -------------------------------- */

test('o cursor vai e volta sem perder nada', () => {
  const c = { criadoEm: new Date('2026-09-21T10:30:00.000Z'), id: '3f2504e0-4f89-11d3-9a0c-0305e82c3301' }
  const lido = textoParaCursor(cursorParaTexto(c))
  assert.equal(lido?.id, c.id)
  assert.equal(lido?.criadoEm.getTime(), c.criadoEm.getTime())
})

test('cursor inventado na URL vira primeira página, não uma tela quebrada', () => {
  // Chega da URL, então chega de qualquer um. Data inválida na consulta
  // derrubaria a página inteira.
  for (const lixo of ['', 'abc', '_', 'nao-e-data_3f2504e0-4f89-11d3-9a0c-0305e82c3301']) {
    assert.equal(textoParaCursor(lixo), null, `deveria recusar: ${lixo}`)
  }
  assert.equal(textoParaCursor(undefined), null)
  assert.equal(textoParaCursor(42), null)
})

test('a parte do id precisa ser um uuid de verdade', () => {
  // Sem isto, qualquer texto depois do sublinhado entraria na consulta.
  const data = '2026-09-21T10:30:00.000Z'
  assert.equal(textoParaCursor(`${data}_`), null)
  assert.equal(textoParaCursor(`${data}_nao-uuid`), null)
  assert.equal(textoParaCursor(`${data}_'; drop table lead; --`), null)
  assert.ok(textoParaCursor(`${data}_3f2504e0-4f89-11d3-9a0c-0305e82c3301`))
})

test('o milissegundo é preservado: é o que desempata leads do mesmo envio', () => {
  // Truncar para o segundo faria dois leads do mesmo formulário caírem no mesmo
  // ponto, e a virada de página cortaria no meio do empate.
  const c = { criadoEm: new Date('2026-09-21T10:30:00.457Z'), id: '3f2504e0-4f89-11d3-9a0c-0305e82c3301' }
  assert.equal(textoParaCursor(cursorParaTexto(c))?.criadoEm.toISOString(), '2026-09-21T10:30:00.457Z')
})

test('a primeira página não oferece "mais recentes"', () => {
  const f = fronteiras({ voltando: false, comCursor: false, temMais: true, vazia: false })
  assert.deepEqual(f, { anterior: false, proxima: true })
})

test('a última página não oferece "mais antigos"', () => {
  const f = fronteiras({ voltando: false, comCursor: true, temMais: false, vazia: false })
  assert.deepEqual(f, { anterior: true, proxima: false })
})

test('lista que cabe numa página só não oferece seta nenhuma', () => {
  const f = fronteiras({ voltando: false, comCursor: false, temMais: false, vazia: false })
  assert.deepEqual(f, { anterior: false, proxima: false })
})

test('voltando, "mais antigos" existe sempre: a página de onde viemos está lá', () => {
  // O caso que erra calado: usar a sobra da consulta para os dois lados daria
  // uma seta faltando ao voltar para o começo, e o usuário perderia o caminho
  // de volta para as páginas que já tinha visto.
  const f = fronteiras({ voltando: true, comCursor: false, temMais: false, vazia: false })
  assert.deepEqual(f, { anterior: false, proxima: true })
})

test('voltando com sobra, os dois lados existem', () => {
  const f = fronteiras({ voltando: true, comCursor: false, temMais: true, vazia: false })
  assert.deepEqual(f, { anterior: true, proxima: true })
})

test('página vazia não oferece seta: não há linha de onde tirar o cursor', () => {
  // Sem isto a tela ofereceria uma seta construída a partir de nada.
  for (const voltando of [true, false]) {
    assert.deepEqual(fronteiras({ voltando, comCursor: true, temMais: true, vazia: true }), {
      anterior: false,
      proxima: false,
    })
  }
})
