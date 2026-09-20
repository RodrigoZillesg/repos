import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { funilParaGravar } from './hubspot.ts'

/** Quando um lead entregue abre negócio no funil do cliente.
 *
 *  O erro caro aqui não é deixar de abrir um negócio: é abrir negócio demais.
 *  O pipeline do cliente alimenta a previsão de vendas dele, e lead frio
 *  entrando como oportunidade estraga o número que ele olha toda segunda. */

test('sem pipeline escolhido, a entrega segue como sempre: contato e nota', () => {
  assert.equal(funilParaGravar({}, true), null)
  assert.equal(funilParaGravar({ estagioQualificado: 's1' }, true), null)
})

test('com pipeline e estágio, o lead qualificado entra no funil', () => {
  assert.deepEqual(funilParaGravar({ pipeline: 'p1', estagioQualificado: 's1' }, true), {
    pipeline: 'p1',
    estagio: 's1',
  })
})

test('lead não qualificado só entra se houver estágio para ele', () => {
  const cfg = { pipeline: 'p1', estagioQualificado: 's1' }
  assert.equal(funilParaGravar(cfg, false), null)
  assert.deepEqual(funilParaGravar({ ...cfg, estagioNaoQualificado: 's0' }, false), {
    pipeline: 'p1',
    estagio: 's0',
  })
})

test('valor em branco vale como "não abrir negócio", não como estágio vazio', () => {
  // Mandar dealstage vazio ao HubSpot devolve 400 e derruba a entrega inteira,
  // contato incluído.
  assert.equal(funilParaGravar({ pipeline: 'p1', estagioQualificado: '' }, true), null)
  assert.equal(funilParaGravar({ pipeline: '', estagioQualificado: 's1' }, true), null)
})

test('config com tipo errado não vira id: null antes de 400', () => {
  assert.equal(funilParaGravar({ pipeline: 7, estagioQualificado: 's1' }, true), null)
  assert.equal(funilParaGravar({ pipeline: 'p1', estagioQualificado: null }, true), null)
})
