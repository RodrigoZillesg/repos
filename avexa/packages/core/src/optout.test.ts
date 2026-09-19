import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { ehPedidoDeParada, ehPedidoDeRetomada } from './optout.ts'

test('reconhece as palavras que as operadoras exigem', () => {
  for (const t of ['STOP', 'stop', ' Stop ', 'UNSUBSCRIBE', 'CANCEL', 'QUIT', 'STOPALL', 'opt-out']) {
    assert.equal(ehPedidoDeParada(t), true, t)
  }
})

test('reconhece os equivalentes em português, com e sem acento', () => {
  for (const t of ['PARAR', 'pare', 'Sair', 'cancelar', 'DESCADASTRAR', 'remover']) {
    assert.equal(ehPedidoDeParada(t), true, t)
  }
})

test('reconhece frases dentro de uma mensagem maior', () => {
  assert.equal(ehPedidoDeParada('Por favor, não me ligue mais, obrigado'), true)
  assert.equal(ehPedidoDeParada('nao quero mais receber nada de voces'), true)
  assert.equal(ehPedidoDeParada('please remove me from your list'), true)
  assert.equal(ehPedidoDeParada('Do not contact me again'), true)
})

test('ignora pontuação e emoji em volta da palavra', () => {
  assert.equal(ehPedidoDeParada('STOP!'), true)
  assert.equal(ehPedidoDeParada('"parar"'), true)
  assert.equal(ehPedidoDeParada('stop 🙏'), true)
})

test('resposta normal de lead interessado não é opt-out', () => {
  for (const t of [
    'Oi, tenho interesse sim',
    'Pode me ligar amanhã de manhã',
    'Quanto custa o curso?',
    'Vou parar para pensar e te aviso',
    'I will stop by the school tomorrow to check it out',
    '',
    null,
  ]) {
    assert.equal(ehPedidoDeParada(t), false, String(t))
  }
})

test('retomada só vale como palavra isolada', () => {
  assert.equal(ehPedidoDeRetomada('START'), true)
  assert.equal(ehPedidoDeRetomada('voltar'), true)
  // Um "yes" no meio de uma frase não desfaz um opt-out.
  assert.equal(ehPedidoDeRetomada('yes, tell me more'), false)
})
