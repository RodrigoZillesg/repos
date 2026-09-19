import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { modeloFixo } from './modelo.ts'
import { qualificar } from './qualificar.ts'

const entrada = {
  contexto: 'Escola de inglês em Sydney',
  criterios: 'Quer começar nos próximos 3 meses',
  historico: 'Lead disse que quer começar em fevereiro.',
}

test('lê a qualificação que o modelo devolveu', async () => {
  const m = modeloFixo('{"score": 82, "motivo": "quer começar em fevereiro", "resumo": "Interessado."}')
  const q = await qualificar(m, entrada)
  assert.equal(q.score, 82)
  assert.equal(q.confiavel, true)
  assert.equal(q.motivo, 'quer começar em fevereiro')
})

test('aceita JSON embrulhado em cerca de código', async () => {
  const m = modeloFixo('```json\n{"score": 40, "motivo": "sem prazo", "resumo": "Vago."}\n```')
  assert.equal((await qualificar(m, entrada)).score, 40)
})

test('prende o score na faixa de 0 a 100', async () => {
  assert.equal((await qualificar(modeloFixo('{"score": 140}'), entrada)).score, 100)
  assert.equal((await qualificar(modeloFixo('{"score": -20}'), entrada)).score, 0)
  assert.equal((await qualificar(modeloFixo('{"score": 72.6}'), entrada)).score, 73)
})

test('modelo ilegível não descarta o lead: score fica nulo e não confiável', async () => {
  // Um score inventado mandaria para o lixo alguém que respondeu de verdade.
  const q = await qualificar(modeloFixo('desculpe, não consegui avaliar'), entrada)
  assert.equal(q.score, null)
  assert.equal(q.confiavel, false)
  assert.match(q.motivo, /não pôde ser lida/)
})

test('sem modelo configurado, devolve o resultado de segurança', async () => {
  const q = await qualificar(null, entrada)
  assert.equal(q.score, null)
  assert.equal(q.confiavel, false)
})
