import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { avaliarCondicao } from './condicao.ts'
import { podeChamarSubfluxo, podeContatar, type FatosContato } from './regras.ts'
import { LIMITES_PADRAO } from './tipos.ts'

const L = LIMITES_PADRAO
const SP = 'America/Sao_Paulo'
/** Terça, 10:00 em São Paulo: dentro da janela, dia útil. */
const AGORA = new Date('2026-03-10T13:00:00Z')

const base: FatosContato = {
  canal: 'whatsapp',
  destinatario: '+5511999999999',
  suprimido: false,
  jaRespondeu: false,
  canalAtivo: true,
  tentativasFeitas: 0,
  ultimoContatoEm: null,
  fusoDoLead: SP,
}

test('deixa passar o contato quando nada bloqueia', () => {
  assert.deepEqual(podeContatar(base, L, AGORA), { pode: true })
})

test('opt-out bloqueia definitivamente, sem reagendar', () => {
  const d = podeContatar({ ...base, suprimido: true }, L, AGORA)
  assert.equal(d.pode, false)
  assert.equal(d.pode === false && d.motivo, 'suprimido')
  assert.equal(d.pode === false && d.definitivo, true)
  assert.equal(d.pode === false && d.adiarPara, undefined)
})

test('a supressão é checada antes de qualquer adiamento', () => {
  // Fora da janela E suprimido: precisa sair como suprimido, senão o motor
  // reagendaria para sempre um contato que nunca poderia sair.
  const madrugada = new Date('2026-03-10T06:00:00Z') // 03:00 em São Paulo
  const d = podeContatar({ ...base, suprimido: true }, L, madrugada)
  assert.equal(d.pode === false && d.motivo, 'suprimido')
})

test('primeira resposta cancela o resto da sequência', () => {
  const d = podeContatar({ ...base, jaRespondeu: true }, L, AGORA)
  assert.equal(d.pode === false && d.motivo, 'ja_respondeu')
  assert.equal(d.pode === false && d.definitivo, true)
})

test('o fluxo pode pedir menos que o teto do sistema, nunca mais', () => {
  // Teto do sistema é 5. Fluxo pedindo 2 vale; fluxo pedindo 99 não levanta o teto.
  assert.equal(podeContatar({ ...base, tentativasFeitas: 2, tetoDoFluxo: 2 }, L, AGORA).pode, false)
  assert.equal(podeContatar({ ...base, tentativasFeitas: 4, tetoDoFluxo: 99 }, L, AGORA).pode, true)
  assert.equal(podeContatar({ ...base, tentativasFeitas: 5, tetoDoFluxo: 99 }, L, AGORA).pode, false)
})

test('fora da janela, adia para a abertura em vez de bloquear', () => {
  const madrugada = new Date('2026-03-10T06:00:00Z') // 03:00 em São Paulo
  const d = podeContatar(base, L, madrugada)
  assert.equal(d.pode === false && d.motivo, 'fora_da_janela')
  assert.equal(d.pode === false && d.definitivo, false)
  assert.equal(d.pode === false && d.adiarPara?.toISOString(), '2026-03-10T12:00:00.000Z')
})

test('um canal por janela: segundo disparo próximo é adiado', () => {
  const d = podeContatar(
    { ...base, ultimoContatoEm: new Date(AGORA.getTime() - 10 * 60_000) },
    L,
    AGORA,
  )
  assert.equal(d.pode === false && d.motivo, 'intervalo_minimo')
  assert.equal(d.pode === false && d.definitivo, false)
  // 10 min atrás + 60 min de intervalo = 50 min à frente, ainda dentro da janela.
  assert.equal(d.pode === false && d.adiarPara?.toISOString(), '2026-03-10T13:50:00.000Z')
})

test('o adiamento por intervalo respeita a janela de contato', () => {
  // 19:30 em São Paulo: +60 min cairia às 20:30, fora da janela. Vai para as 09:00.
  const tarde = new Date('2026-03-10T22:30:00Z')
  const d = podeContatar({ ...base, ultimoContatoEm: tarde }, L, tarde)
  const adiado = d.pode === false ? d.adiarPara! : null
  assert.equal(adiado?.toISOString(), '2026-03-11T12:00:00.000Z')
})

test('template pendente na Meta impede o envio', () => {
  const d = podeContatar({ ...base, templateAprovado: false }, L, AGORA)
  assert.equal(d.pode === false && d.motivo, 'template_nao_aprovado')
})

test('canal não contratado pelo cliente não dispara', () => {
  assert.equal(podeContatar({ ...base, canalAtivo: false }, L, AGORA).pode, false)
})

test('subfluxo que volta ao ponto de partida é cortado', () => {
  assert.deepEqual(podeChamarSubfluxo(['f1'], 'f2', L), { pode: true })
  assert.deepEqual(podeChamarSubfluxo(['f1', 'f2'], 'f1', L), { pode: false, motivo: 'laco' })
})

test('cadeia longa demais é cortada mesmo sem repetir fluxo', () => {
  const r = podeChamarSubfluxo(['f1', 'f2', 'f3'], 'f4', L)
  assert.deepEqual(r, { pode: false, motivo: 'profundidade' })
})

test('condição compara número, texto e sim/não', () => {
  const ctx = { score: 72, respondeu: true, utm: { utm_source: 'google-ads' } }
  assert.equal(avaliarCondicao({ campo: 'Score do lead', op: 'é maior que', valor: '70' }, ctx), true)
  assert.equal(avaliarCondicao({ campo: 'Score do lead', op: 'é menor que', valor: '70' }, ctx), false)
  assert.equal(avaliarCondicao({ campo: 'Lead respondeu', op: 'é igual a', valor: 'Sim' }, ctx), true)
  assert.equal(
    avaliarCondicao({ campo: 'utm_source', op: 'começa com', valor: 'google' }, ctx),
    true,
  )
})

test('campo personalizado que ninguém previu continua utilizável', () => {
  const ctx = { campos: { unidade: 'Sydney CBD', turno: 'noite' } }
  assert.equal(
    avaliarCondicao(
      { campo: 'Campo personalizado', chave: 'unidade', op: 'é igual a', valor: 'sydney cbd' },
      ctx,
    ),
    true,
  )
})

test('campo ausente devolve falso em vez de derrubar o fluxo', () => {
  assert.equal(
    avaliarCondicao({ campo: 'Campo personalizado', chave: 'inexistente', op: 'é igual a', valor: 'x' }, {}),
    false,
  )
  assert.equal(avaliarCondicao({ campo: 'Score do lead', op: 'é maior que', valor: '50' }, {}), false)
})
