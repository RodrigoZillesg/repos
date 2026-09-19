import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { simular, type Persona } from './simulador.ts'
import { LIMITES_PADRAO, type Etapa, type Grafo } from './tipos.ts'

const e = (id: string, tipo: Etapa['tipo'], cfg: Record<string, string> = {}, extra: Partial<Etapa> = {}): Etapa =>
  ({ id, tipo, cfg, ...extra })

/** Fluxo "Lead novo do site": tenta ligação, espera, WhatsApp, espera, e-mail,
 *  qualifica e entrega ou encerra. É a forma do fluxo padrão do artefato. */
const FLUXO: Grafo = [
  e('n1', 'entrada', { metodo: 'POST (JSON)', utm: 'Sim, todas as utm_*', idade: '24 horas' }),
  e('n2', 'guarda', { janela: '09:00 às 20:00', fds: 'Não' }),
  e('n3', 'ligacao', { roteiro: 'Qualificação inicial', vm: 'Deixar recado' }),
  e('n4', 'espera', { dur: '2 horas', cancel: 'Sim' }),
  e('n5', 'whatsapp', { modo: 'Template aprovado', template: 'Primeiro contato', conversa: 'Sim' }),
  e('n6', 'espera', { dur: '24 horas', cancel: 'Sim' }),
  e('n7', 'email', { template: 'Retomada', replyto: 'Time do cliente' }),
  e('n8', 'score', { corte: '60' }),
  e(
    'n9',
    'condicao',
    { campo: 'Score do lead', op: 'é maior que', valor: '60' },
    {
      sim: [e('n10', 'entregar', { destino: 'CRM do cliente', urgente: 'Sim' })],
      nao: [e('n11', 'encerrar', { motivo: 'Não respondeu' })],
    },
  ),
]

const rodar = (p: Persona) => simular(FLUXO, p)

test('lead quente responde na primeira tentativa e a sequência para', () => {
  const r = rodar('quente')
  assert.equal(r.contatos, 1)
  assert.equal(r.respondeu, true)
  assert.equal(r.motivoFinal, 'lead respondeu')
  // Nenhum contato depois da resposta, em nenhum canal.
  const canais = r.eventos.filter((x) => x.tipo === 'contato').map((x) => x.canal)
  assert.deepEqual(canais, ['ligacao'])
})

test('lead morno só responde na segunda tentativa', () => {
  const r = rodar('morno')
  assert.equal(r.contatos, 2)
  assert.equal(r.respondeu, true)
  const canais = r.eventos.filter((x) => x.tipo === 'contato').map((x) => x.canal)
  assert.deepEqual(canais, ['ligacao', 'whatsapp'])
})

test('lead que ignora telefone é alcançado no e-mail', () => {
  const r = rodar('email')
  assert.equal(r.respondeu, true)
  const canais = r.eventos.filter((x) => x.tipo === 'contato').map((x) => x.canal)
  assert.deepEqual(canais, ['ligacao', 'whatsapp', 'email'])
})

test('lead frio percorre a sequência inteira e encerra sem resposta', () => {
  const r = rodar('frio')
  assert.equal(r.respondeu, false)
  assert.equal(r.contatos, 3)
  const encerramento = r.eventos.at(-1)
  assert.equal(encerramento?.detalhe, 'Não respondeu')
})

test('opt-out entra na supressão e nada mais é disparado', () => {
  const r = rodar('optout')
  assert.equal(r.suprimido, true)
  assert.equal(r.contatos, 1)
  // O bloqueio seguinte sai como supressão, não como qualquer outro motivo.
  assert.equal(r.motivoFinal, 'lead respondeu')
  assert.equal(r.eventos.filter((x) => x.tipo === 'contato').length, 1)
})

test('as esperas respeitam a janela de contato do lead', () => {
  // Começa às 19:00: a espera de 2 horas cai na manhã seguinte, não às 21h.
  const r = simular(FLUXO, 'frio', { inicio: new Date('2026-03-10T22:00:00Z') })
  const espera = r.eventos.find((x) => x.tipo === 'espera')
  assert.ok(espera?.detalhe?.includes('2026-03-11T13:00:00.000Z'), espera?.detalhe)
})

test('canal não contratado é bloqueado e o fluxo segue para o próximo', () => {
  const r = simular(FLUXO, 'frio', { canaisAtivos: ['email'] })
  const bloqueios = r.eventos.filter((x) => x.tipo === 'bloqueio')
  assert.deepEqual(
    bloqueios.map((x) => x.canal),
    ['ligacao', 'whatsapp'],
  )
  assert.equal(r.contatos, 1)
  assert.equal(r.eventos.find((x) => x.tipo === 'contato')?.canal, 'email')
})

test('o teto de tentativas corta a sequência antes do fluxo acabar', () => {
  const r = simular(FLUXO, 'frio', {
    limites: { ...LIMITES_PADRAO, tetoTentativas: 2 },
  })
  assert.equal(r.contatos, 2)
  assert.equal(r.motivoFinal, 'teto_de_tentativas')
})

test('a repetição dá o número de voltas configurado e sai', () => {
  const comLoop: Grafo = [
    e('a1', 'entrada', {}),
    e('a2', 'loop', { max: '3', sair: 'O lead responder' }, {
      corpo: [e('a3', 'sms', { template: 'Lembrete' }), e('a4', 'espera', { dur: '30 minutos', cancel: 'Não' })],
    }),
    e('a5', 'encerrar', { motivo: 'Não respondeu' }),
  ]
  const r = simular(comLoop, 'frio')
  assert.equal(r.contatos, 3)
  assert.equal(r.eventos.some((x) => x.detalhe === 'Não respondeu'), true)
})

test('a repetição sai antes do limite quando o lead responde', () => {
  const comLoop: Grafo = [
    e('b1', 'entrada', {}),
    e('b2', 'loop', { max: '4', sair: 'O lead responder' }, {
      corpo: [e('b3', 'sms', { template: 'Lembrete' })],
    }),
    e('b4', 'entregar', { destino: 'CRM do cliente', urgente: 'Não' }),
  ]
  const r = simular(comLoop, 'morno')
  assert.equal(r.contatos, 2)
  assert.equal(r.respondeu, true)
  // Saiu da repetição na resposta e seguiu para a etapa depois dela.
  assert.equal(r.eventos.some((x) => x.rotulo === 'Entregar ao time'), true)
})

test('a condição escolhe o ramo pelo contexto acumulado', () => {
  const rQuente = rodar('quente')
  const rFrio = rodar('frio')
  // Quente responde e para antes de chegar na condição; frio chega e cai no "não".
  assert.equal(rQuente.eventos.some((x) => x.rotulo === 'Entregar ao time'), false)
  assert.equal(rFrio.eventos.some((x) => x.rotulo === 'Encerrar'), true)
})
