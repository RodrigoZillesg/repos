import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  dentroDaJanela,
  duracaoEmMinutos,
  partesEm,
  proximaJanela,
  somarDentroDaJanela,
} from './janela.ts'
import { LIMITES_PADRAO } from './tipos.ts'

const SP = 'America/Sao_Paulo'
const SYD = 'Australia/Sydney'
const L = LIMITES_PADRAO

test('decompõe um instante no relógio do fuso do lead', () => {
  // 2026-03-10T12:00Z é 09:00 em São Paulo (UTC-3).
  const p = partesEm(new Date('2026-03-10T12:00:00Z'), SP)
  assert.equal(p.hora, 9)
  assert.equal(p.dia, 10)
  assert.equal(p.diaSemana, 2) // terça
})

test('reconhece dentro e fora da janela de contato', () => {
  assert.equal(dentroDaJanela(new Date('2026-03-10T12:00:00Z'), SP, L), true) // 09:00
  assert.equal(dentroDaJanela(new Date('2026-03-10T11:59:00Z'), SP, L), false) // 08:59
  assert.equal(dentroDaJanela(new Date('2026-03-10T23:00:00Z'), SP, L), false) // 20:00, fim exclusivo
})

test('fora da janela, a tentativa espera a próxima abertura', () => {
  // Terça 22:00 em São Paulo -> quarta 09:00.
  const r = proximaJanela(new Date('2026-03-11T01:00:00Z'), SP, L)
  const p = partesEm(r, SP)
  assert.equal(p.dia, 11)
  assert.equal(p.hora, 9)
  assert.equal(p.minuto, 0)
})

test('pula o fim de semana quando o contato não é permitido', () => {
  // Sábado 14:00 em São Paulo -> segunda 09:00.
  const sabado = new Date('2026-03-14T17:00:00Z')
  assert.equal(partesEm(sabado, SP).diaSemana, 6)
  const r = proximaJanela(sabado, SP, L)
  const p = partesEm(r, SP)
  assert.equal(p.diaSemana, 1)
  assert.equal(p.dia, 16)
  assert.equal(p.hora, 9)
})

test('uma espera de 2 horas às 19h continua na manhã seguinte', () => {
  // A promessa literal do produto. 19:00 em São Paulo, faltando 1h para fechar:
  // consome 1h hoje e a hora restante cai às 09:00 do dia seguinte.
  const dezenove = new Date('2026-03-10T22:00:00Z')
  assert.equal(partesEm(dezenove, SP).hora, 19)
  const r = somarDentroDaJanela(dezenove, 120, SP, L)
  const p = partesEm(r, SP)
  assert.equal(p.dia, 11)
  assert.equal(p.hora, 10)
  assert.equal(p.minuto, 0)
})

test('espera curta dentro da janela não é adiada', () => {
  const r = somarDentroDaJanela(new Date('2026-03-10T13:00:00Z'), 30, SP, L)
  assert.equal(r.toISOString(), '2026-03-10T13:30:00.000Z')
})

test('espera de 3 dias atravessa o fim de semana', () => {
  // Quinta 10:00 em São Paulo + 3 dias úteis de janela (11h/dia) -> quarta.
  const quinta = new Date('2026-03-12T13:00:00Z')
  assert.equal(partesEm(quinta, SP).diaSemana, 4)
  const r = somarDentroDaJanela(quinta, 3 * 1440, SP, L)
  assert.equal(dentroDaJanela(r, SP, L), true)
  assert.notEqual(partesEm(r, SP).diaSemana, 0)
  assert.notEqual(partesEm(r, SP).diaSemana, 6)
})

test('respeita o fuso do lead, não o do servidor', () => {
  // Mesmo instante: 16:00 em Sydney, 02:00 em São Paulo. Sydney contata, SP não.
  const instante = new Date('2026-03-10T05:00:00Z')
  assert.equal(partesEm(instante, SYD).hora, 16)
  assert.equal(partesEm(instante, SP).hora, 2)
  assert.equal(dentroDaJanela(instante, SYD, L), true)
  assert.equal(dentroDaJanela(instante, SP, L), false)
})

test('atravessa a virada de horário de verão sem pular a abertura', () => {
  // Austrália sai do horário de verão em 2026-04-05. A abertura continua às 09:00
  // locais, mesmo com o deslocamento mudando de +11 para +10.
  const r = proximaJanela(new Date('2026-04-04T20:00:00Z'), SYD, L)
  assert.equal(partesEm(r, SYD).hora, 9)
})

test('lê as durações como o construtor as escreve', () => {
  assert.equal(duracaoEmMinutos('5 minutos'), 5)
  assert.equal(duracaoEmMinutos('2 horas'), 120)
  assert.equal(duracaoEmMinutos('3 dias'), 4320)
  assert.throws(() => duracaoEmMinutos('amanhã'))
})
