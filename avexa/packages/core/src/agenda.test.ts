import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { escolherConsultor, horariosLivres } from './agenda.ts'
import { LIMITES_PADRAO } from './tipos.ts'

const SP = 'America/Sao_Paulo'
const L = LIMITES_PADRAO
const base = {
  fuso: SP,
  limites: L,
  duracaoMin: 30,
  de: new Date('2026-03-10T12:00:00Z'), // terça, 09:00 em São Paulo
  ate: new Date('2026-03-11T23:00:00Z'),
}

test('oferece os primeiros horários livres da janela', () => {
  const r = horariosLivres({ ...base, ocupados: [] })
  assert.deepEqual(
    r.map((d) => d.toISOString()),
    ['2026-03-10T12:00:00.000Z', '2026-03-10T12:30:00.000Z', '2026-03-10T13:00:00.000Z'],
  )
})

test('pula o que já está ocupado', () => {
  const r = horariosLivres({
    ...base,
    ocupados: [
      { inicio: new Date('2026-03-10T12:00:00Z'), fim: new Date('2026-03-10T13:00:00Z') },
    ],
    quantos: 2,
  })
  assert.deepEqual(
    r.map((d) => d.toISOString()),
    ['2026-03-10T13:00:00.000Z', '2026-03-10T13:30:00.000Z'],
  )
})

test('funde ocupados sobrepostos de consultores diferentes', () => {
  const r = horariosLivres({
    ...base,
    ocupados: [
      { inicio: new Date('2026-03-10T12:00:00Z'), fim: new Date('2026-03-10T13:00:00Z') },
      { inicio: new Date('2026-03-10T12:30:00Z'), fim: new Date('2026-03-10T14:00:00Z') },
    ],
    quantos: 1,
  })
  assert.equal(r[0]?.toISOString(), '2026-03-10T14:00:00.000Z')
})

test('respeita a folga antes e depois de cada compromisso', () => {
  const r = horariosLivres({
    ...base,
    ocupados: [
      { inicio: new Date('2026-03-10T13:00:00Z'), fim: new Date('2026-03-10T13:30:00Z') },
    ],
    folgaMin: 15,
    quantos: 2,
  })
  // 12:00 cabe; 12:30 encostaria na folga de 12:45.
  assert.deepEqual(
    r.map((d) => d.toISOString()),
    ['2026-03-10T12:00:00.000Z', '2026-03-10T14:00:00.000Z'],
  )
})

test('a reunião inteira precisa caber na janela, não só o começo', () => {
  // 19h30 em São Paulo, janela fecha às 20h: 45 minutos não cabem.
  const r = horariosLivres({
    ...base,
    duracaoMin: 45,
    de: new Date('2026-03-10T22:30:00Z'),
    ate: new Date('2026-03-12T23:00:00Z'),
    ocupados: [],
    quantos: 1,
  })
  const primeiro = r[0]!
  assert.equal(primeiro.toISOString(), '2026-03-11T12:00:00.000Z')
})

test('não oferece horário fora da janela de contato do lead', () => {
  const r = horariosLivres({
    ...base,
    de: new Date('2026-03-10T05:00:00Z'), // 02:00 em São Paulo
    ocupados: [],
    quantos: 1,
  })
  assert.equal(r[0]?.toISOString(), '2026-03-10T12:00:00.000Z')
})

test('arredonda para o passo: ninguém oferece 14h07', () => {
  const r = horariosLivres({
    ...base,
    de: new Date('2026-03-10T12:07:00Z'),
    ocupados: [],
    quantos: 1,
  })
  assert.equal(r[0]?.toISOString(), '2026-03-10T12:30:00.000Z')
})

test('agenda cheia devolve lista vazia em vez de girar sem fim', () => {
  const r = horariosLivres({
    ...base,
    ate: new Date('2026-03-10T23:00:00Z'),
    ocupados: [
      { inicio: new Date('2026-03-10T00:00:00Z'), fim: new Date('2026-03-12T00:00:00Z') },
    ],
  })
  assert.deepEqual(r, [])
})

test('o rodízio dá a vez a quem tem menos compromissos', () => {
  const inicio = new Date('2026-03-10T12:00:00Z')
  const fim = new Date('2026-03-10T12:30:00Z')
  const escolhido = escolherConsultor(['ana', 'bruno'], {
    ana: [{ inicio: new Date('2026-03-10T15:00:00Z'), fim: new Date('2026-03-10T16:00:00Z') }],
    bruno: [],
  }, inicio, fim)
  assert.equal(escolhido, 'bruno')
})

test('o rodízio não escolhe quem está ocupado naquele horário', () => {
  const inicio = new Date('2026-03-10T12:00:00Z')
  const fim = new Date('2026-03-10T12:30:00Z')
  assert.equal(
    escolherConsultor(['ana', 'bruno'], {
      ana: [],
      bruno: [{ inicio, fim }],
    }, inicio, fim),
    'ana',
  )
  assert.equal(
    escolherConsultor(['bruno'], { bruno: [{ inicio, fim }] }, inicio, fim),
    null,
  )
})
