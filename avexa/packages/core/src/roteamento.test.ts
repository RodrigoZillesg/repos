import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { ETAPAS, cfgPadrao, roteamentoDaEtapa } from './etapas.ts'

/** Para onde o nó "Agendar reunião" manda a reunião.
 *
 *  O campo mudou de "dois rótulos fixos" para "id de uma agenda do cliente".
 *  O risco real da mudança é o fluxo já publicado: se um rótulo antigo passasse
 *  a ser lido como id, a marcação falharia em produção. */

test('nada escolhido usa todas as agendas do cliente, em rodízio', () => {
  assert.deepEqual(roteamentoDaEtapa({}), { calendario: null, rodizio: true })
})

test('a etapa nova nasce igual ao que o cliente configurou em Integrações', () => {
  const c = cfgPadrao('agendar')
  assert.deepEqual(roteamentoDaEtapa(c), { calendario: null, rodizio: true })
})

test('escolher "primeira disponível" desliga o rodízio sem mirar agenda nenhuma', () => {
  assert.deepEqual(roteamentoDaEtapa({ distribuicao: 'Primeira disponível' }), {
    calendario: null,
    rodizio: false,
  })
})

test('uma agenda específica é o roteamento: dois nós miram times diferentes', () => {
  assert.deepEqual(roteamentoDaEtapa({ agenda: 'comercial@cliente.com' }), {
    calendario: 'comercial@cliente.com',
    rodizio: false,
  })
})

test('com uma agenda só, rodízio não se aplica nem se ficou marcado', () => {
  // Rodiziar entre um é o mesmo que não rodiziar, e deixar a bandeira ligada
  // faria o motor pular a checagem de colisão daquela agenda.
  const r = roteamentoDaEtapa({ agenda: 'ana@cliente.com', distribuicao: 'Rodízio entre consultores' })
  assert.equal(r.rodizio, false)
})

test('fluxo publicado com o rótulo antigo continua rodiziando', () => {
  assert.deepEqual(roteamentoDaEtapa({ agenda: 'Rodízio entre consultores' }), {
    calendario: null,
    rodizio: true,
  })
})

test('o outro rótulo antigo continua marcando na primeira agenda livre', () => {
  assert.deepEqual(roteamentoDaEtapa({ agenda: 'Time comercial do cliente' }), {
    calendario: null,
    rodizio: false,
  })
})

test('o campo de distribuição some quando já há uma agenda escolhida', () => {
  const campo = ETAPAS.agendar.campos.find((c) => c.k === 'distribuicao')!
  assert.equal(campo.visivelSe!({ agenda: '' }), true)
  assert.equal(campo.visivelSe!({ agenda: 'ana@cliente.com' }), false)
  // O rótulo antigo ainda quer dizer "todas", então o campo continua visível.
  assert.equal(campo.visivelSe!({ agenda: 'Rodízio entre consultores' }), true)
})

test('o resumo do cartão diz para onde a reunião vai', () => {
  const r = ETAPAS.agendar.resumo
  assert.match(r({ agenda: 'ana@cliente.com', dur: '30 minutos' }), /ana@cliente\.com/)
  assert.match(r({ dur: '30 minutos' }), /rodízio/)
  assert.match(r({ dur: '30 minutos', distribuicao: 'Primeira disponível' }), /primeira agenda livre/)
})
