import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { buscarEtapas } from './busca-etapas.ts'

/** A paleta com busca existe para quem monta fluxo o dia inteiro: três letras
 *  e Enter. Estes testes prendem o que torna isso rápido — e o que impediria
 *  alguém de inserir uma etapa de um canal que o cliente não contratou. */

const TODOS = { ligacao: true, whatsapp: true, sms: true, email: true }

test('sem termo, oferece todas as etapas inseríveis', () => {
  const r = buscarEtapas('', TODOS)
  assert.ok(r.length >= 10)
  // `entrada` é fixa: não se insere nem se remove.
  assert.equal(r.some((e) => e.tipo === 'entrada'), false)
})

test('acento não atrapalha: "ligacao" acha "Ligação"', () => {
  // Quem digita rápido não põe acento, e a etapa tem.
  assert.ok(buscarEtapas('ligacao', TODOS).some((e) => e.tipo === 'ligacao'))
  assert.ok(buscarEtapas('LIGAÇÃO', TODOS).some((e) => e.tipo === 'ligacao'))
})

test('quem começa com o termo vem antes de quem só o contém', () => {
  // Digitar "esp" tem que trazer "Esperar" primeiro, não uma etapa que tem
  // "esp" no meio do nome.
  const r = buscarEtapas('esp', TODOS)
  assert.equal(r[0]?.tipo, 'espera')
})

test('dá para achar pelo grupo também', () => {
  // "Integração" não é nome de etapa nenhuma: só casa como grupo.
  const r = buscarEtapas('integra', TODOS)
  assert.ok(r.length > 0)
  assert.ok(r.every((e) => e.grupo === 'Integração'))
})

test('casar pelo nome vale mais que casar pelo grupo', () => {
  // Procurando "saída": "Webhook de saída" casa pelo NOME e tem que vir antes
  // das etapas do grupo Saída, que casam por uma via mais fraca.
  const r = buscarEtapas('saída', TODOS)
  assert.equal(r[0]?.tipo, 'webhookout')
  assert.ok(r.some((e) => e.grupo === 'Saída'), 'o grupo também entra, só que depois')
})

test('canal não contratado aparece bloqueado, em vez de sumir', () => {
  // Esconder faria o operador procurar uma etapa que ele sabe que existe.
  const r = buscarEtapas('whats', { ...TODOS, whatsapp: false })
  const wa = r.find((e) => e.tipo === 'whatsapp')
  assert.ok(wa, 'a etapa continua na lista')
  assert.equal(wa!.bloqueada, true)
})

test('canal contratado não vem bloqueado', () => {
  assert.equal(buscarEtapas('whats', TODOS).find((e) => e.tipo === 'whatsapp')?.bloqueada, false)
})

test('termo sem correspondência devolve lista vazia, não tudo', () => {
  // Devolver tudo faria o Enter inserir uma etapa aleatória.
  assert.deepEqual(buscarEtapas('xyzzy', TODOS), [])
})

test('espaço em volta do termo é ignorado', () => {
  assert.ok(buscarEtapas('  sms  ', TODOS).some((e) => e.tipo === 'sms'))
})
