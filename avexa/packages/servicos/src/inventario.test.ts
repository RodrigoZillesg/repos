import { test } from 'node:test'
import assert from 'node:assert/strict'
import { LIMITE_APELIDO, apelidoPadrao, cruzar, type DonoDoNumero } from './inventario.ts'
import type { NumeroDaConta } from '@avexa/adapters'

const doTwilio = (e164: string, apelido: string): NumeroDaConta => ({
  sid: `PN_${e164}`,
  e164,
  apelido,
  capacidades: ['voz', 'sms'],
  webhookSms: 'https://new.avexa.global/api/webhooks/sms',
  webhookVoz: null,
})

const nosso = (p: Partial<DonoDoNumero> & { e164: string }): DonoDoNumero => ({
  provedorSid: `PN_${p.e164}`,
  status: 'atribuido',
  clienteId: 'c1',
  clienteNome: 'International House',
  projetoId: 'p1',
  projetoNome: 'Sydney CBD',
  ...p,
})

test('o apelido junta cliente e projeto', () => {
  assert.equal(apelidoPadrao('International House', 'Sydney CBD'), 'International House · Sydney CBD')
})

test('sem projeto, o apelido é só o cliente', () => {
  assert.equal(apelidoPadrao('International House', null), 'International House')
  assert.equal(apelidoPadrao('International House', '   '), 'International House')
})

test('espaço sobrando não muda o apelido', () => {
  assert.equal(apelidoPadrao('  International   House ', ' Sydney  CBD '), 'International House · Sydney CBD')
})

test('apelido longo cabe no limite do Twilio e mantém os dois lados', () => {
  const cliente = 'Universidade Federal do Rio Grande do Sul e Adjacências'
  const projeto = 'Campanha de Inverno para Intercâmbio na Oceania'
  const r = apelidoPadrao(cliente, projeto)

  assert.ok(r.length <= LIMITE_APELIDO, `apelido com ${r.length} caracteres`)
  // O que não pode acontecer é o projeto sumir: é ele que distingue um número
  // do outro dentro do mesmo cliente.
  assert.ok(r.includes('·'), `perdeu o separador: ${r}`)
  const [c, p] = r.split(' · ')
  assert.ok(c!.length > 3 && p!.length > 3, `um dos lados sumiu: ${r}`)
})

test('cliente curto com projeto longo devolve o resto ao projeto', () => {
  const r = apelidoPadrao('IH', 'Campanha de Inverno para Intercâmbio na Oceania e Sudeste Asiático')
  assert.ok(r.length <= LIMITE_APELIDO)
  assert.ok(r.startsWith('IH · '), r)
  // Se o projeto ficasse preso na metade, sobraria espaço sem uso.
  assert.ok(r.length > LIMITE_APELIDO - 3, `desperdiçou espaço: ${r.length} de ${LIMITE_APELIDO}`)
})

test('número no Twilio que a Avexa não conhece é de fora', () => {
  const r = cruzar([doTwilio('+61255500999', 'Alice AI EN TALOGY - Path B')], [])
  assert.equal(r.length, 1)
  assert.equal(r[0]!.origem, 'fora')
  assert.equal(r[0]!.apelido, 'Alice AI EN TALOGY - Path B')
  assert.equal(r[0]!.clienteNome, null)
  // Sem dono registrado não há nome a sugerir, e sugerir um seria inventar.
  assert.equal(r[0]!.apelidoSugerido, null)
  assert.equal(r[0]!.foraDoPadrao, false)
})

test('número na Avexa que não existe no Twilio aparece como sumido', () => {
  // É o caso dos quatro números do seed: atribuídos, com canal ligado, e nada
  // sai por eles.
  const r = cruzar([], [nosso({ e164: '+61255500101', provedorSid: null })])
  assert.equal(r.length, 1)
  assert.equal(r[0]!.origem, 'sumido')
  assert.equal(r[0]!.sid, null)
  assert.equal(r[0]!.clienteNome, 'International House')
})

test('apelido diferente do dono registrado é marcado fora do padrão', () => {
  const r = cruzar([doTwilio('+61255500101', 'numero antigo')], [nosso({ e164: '+61255500101' })])
  assert.equal(r[0]!.origem, 'avexa')
  assert.equal(r[0]!.apelidoSugerido, 'International House · Sydney CBD')
  assert.equal(r[0]!.foraDoPadrao, true)
})

test('apelido igual ao sugerido não é fora do padrão', () => {
  const r = cruzar(
    [doTwilio('+61255500101', 'International House · Sydney CBD')],
    [nosso({ e164: '+61255500101' })],
  )
  assert.equal(r[0]!.foraDoPadrao, false)
})

test('os sumidos vêm primeiro e os de fora por último', () => {
  const r = cruzar(
    [doTwilio('+1000', 'de fora'), doTwilio('+61255500101', 'International House · Sydney CBD')],
    [nosso({ e164: '+61255500101' }), nosso({ e164: '+61255500102', provedorSid: null })],
  )
  assert.deepEqual(
    r.map((x) => x.origem),
    ['sumido', 'avexa', 'fora'],
  )
})

test('nenhum número é contado duas vezes', () => {
  const r = cruzar(
    [doTwilio('+61255500101', 'x'), doTwilio('+1000', 'y')],
    [nosso({ e164: '+61255500101' })],
  )
  assert.equal(r.length, 2)
  assert.equal(new Set(r.map((x) => x.e164)).size, 2)
})
