import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { aplanar, preencherPercurso } from './layout.ts'
import { PERSONAS, simular, type Persona } from './simulador.ts'
import type { Etapa, Grafo } from './tipos.ts'

/** O desenho tem que ser o que o motor executa.
 *
 *  Um desenho bonito que mostra um caminho que o motor não percorre — ou que
 *  esconde um que ele percorre — é pior que nenhum desenho: o operador revisa o
 *  fluxo olhando a tela e conclui coisa errada sobre o que vai acontecer com
 *  gente de verdade. Por isso o teste principal aqui é diferencial: roda o
 *  motor e confere que cada passo dele existe como aresta. */

const e = (id: string, tipo: Etapa['tipo'], cfg: Record<string, string> = {}, extra: Partial<Etapa> = {}): Etapa =>
  ({ id, tipo, cfg, ...extra })

const ids = (g: ReturnType<typeof aplanar>) => g.nos.map((n) => n.id)
const temAresta = (g: ReturnType<typeof aplanar>, de: string, para: string) =>
  g.arestas.some((a) => a.de === de && a.para === para)

test('sequência simples vira uma corrente de arestas', () => {
  const g = aplanar([e('1', 'entrada'), e('2', 'whatsapp'), e('3', 'entregar')])
  assert.deepEqual(ids(g), ['1', '2', '3'])
  assert.ok(temAresta(g, '1', '2'))
  assert.ok(temAresta(g, '2', '3'))
  assert.equal(g.arestas.length, 2)
})

test('encerrar não tem saída: o motor para ali', () => {
  // Desenhar uma aresta saindo daqui mostraria um caminho que não existe.
  const g = aplanar([e('1', 'entrada'), e('2', 'encerrar'), e('3', 'entregar')])
  assert.equal(temAresta(g, '2', '3'), false)
})

test('os dois ramos da condição reconvergem no que vem depois', () => {
  // É o que `seguinte()` faz: sobe para o pai, apaga o ramo e segue do irmão.
  // Sem esta junção, o desenho mostraria dois becos sem saída.
  const g = aplanar([
    e('1', 'entrada'),
    e('2', 'condicao', {}, { sim: [e('s', 'whatsapp')], nao: [e('n', 'sms')] }),
    e('3', 'entregar'),
  ])
  assert.ok(temAresta(g, '2', 's'))
  assert.ok(temAresta(g, '2', 'n'))
  assert.ok(temAresta(g, 's', '3'), 'a ponta do sim volta ao tronco')
  assert.ok(temAresta(g, 'n', '3'), 'a ponta do não volta ao tronco')
  assert.equal(g.arestas.filter((a) => a.tipo === 'juncao').length, 2)
})

test('ramo vazio não é beco: a condição liga direto no que vem depois', () => {
  // `proximaInstrucao` com `filhos.length === 0` cai no irmão seguinte. Omitir
  // esta aresta esconderia um caminho que o lead percorre de verdade.
  const g = aplanar([
    e('1', 'entrada'),
    e('2', 'condicao', {}, { sim: [e('s', 'whatsapp')], nao: [] }),
    e('3', 'entregar'),
  ])
  assert.ok(temAresta(g, '2', '3'), 'o ramo vazio segue adiante')
})

test('a repetição tem aresta de volta: é o ciclo governado', () => {
  const g = aplanar([
    e('1', 'entrada'),
    e('2', 'loop', {}, { corpo: [e('c', 'espera')] }),
    e('3', 'entregar'),
  ])
  assert.ok(temAresta(g, '2', 'c'), 'entra no corpo')
  assert.ok(temAresta(g, 'c', '2'), 'o fim do corpo volta para a repetição')
  assert.ok(temAresta(g, '2', '3'), 'e a repetição também é a porta de saída')
  assert.equal(g.arestas.filter((a) => a.tipo === 'volta').length, 1)
})

test('o corpo da repetição sabe de quem é, para poder ser desenhado como caixa', () => {
  const g = aplanar([e('1', 'loop', {}, { corpo: [e('c', 'espera')] })])
  const dentro = g.nos.find((n) => n.id === 'c')!
  assert.equal(dentro.dentroDe, '1')
  assert.equal(dentro.ramo, 'corpo')
  assert.equal(dentro.nivel, 1)
})

test('os rótulos das arestas são os que o operador lê', () => {
  const g = aplanar([
    e('1', 'condicao', {}, { sim: [e('s', 'whatsapp')], nao: [e('n', 'sms')] }),
  ])
  assert.equal(g.arestas.find((a) => a.para === 's')?.rotulo, 'sim')
  assert.equal(g.arestas.find((a) => a.para === 'n')?.rotulo, 'não')
})

test('todo nó aparece uma vez só', () => {
  // Nó duplicado no desenho vira etapa fantasma, e `tentativa.etapaId` aponta
  // para uma delas — o destaque de execução acenderia a errada.
  const g = aplanar([
    e('1', 'entrada'),
    e('2', 'condicao', {}, {
      sim: [e('s1', 'whatsapp'), e('s2', 'espera')],
      nao: [e('n1', 'sms')],
    }),
    e('3', 'loop', {}, { corpo: [e('c1', 'ligacao')] }),
  ])
  const vistos = ids(g)
  assert.equal(new Set(vistos).size, vistos.length)
  assert.equal(vistos.length, 7)
})

test('nenhuma aresta aponta para um nó que não existe', () => {
  const g = aplanar([
    e('1', 'entrada'),
    e('2', 'condicao', {}, { sim: [e('s', 'whatsapp')], nao: [] }),
    e('3', 'loop', {}, { corpo: [e('c', 'espera')] }),
    e('4', 'encerrar'),
  ])
  const existe = new Set(ids(g))
  for (const a of g.arestas) {
    assert.ok(existe.has(a.de), `aresta sai de nó inexistente: ${a.de}`)
    assert.ok(existe.has(a.para), `aresta chega em nó inexistente: ${a.para}`)
  }
})

/* ----------------------- A prova que realmente importa --------------------- */

/** Um fluxo com tudo: condição com os dois ramos, repetição e saída. */
const COMPLETO: Grafo = [
  e('entrada', 'entrada'),
  e('guarda', 'guarda'),
  e('wa', 'whatsapp', { modo: 'Texto livre com IA' }),
  e(
    'cond',
    'condicao',
    { campo: 'score', op: 'é maior que', valor: '50' },
    {
      sim: [e('liga', 'ligacao'), e('agenda', 'agendar', { dur: '30 minutos' })],
      nao: [e('sms', 'sms')],
    },
  ),
  e('rep', 'loop', { max: '2' }, { corpo: [e('espera', 'espera'), e('email', 'email')] }),
  e('entrega', 'entregar', { destino: 'CRM do cliente' }),
]

/** Existe caminho de `de` até `para` seguindo as arestas desenhadas?
 *
 *  Alcançabilidade, e não adjacência direta, porque nem toda etapa emite
 *  evento: `condicao`, `guarda` e `loop` decidem em silêncio. No log do motor a
 *  execução parece pular de uma etapa de canal para outra, quando na verdade
 *  passou por uma decisão no meio. O que o desenho precisa garantir é que o
 *  caminho existe — se uma junção faltar ou uma aresta estiver invertida, não
 *  existe. */
function alcanca(g: ReturnType<typeof aplanar>, de: string, para: string): boolean {
  const saem = new Map<string, string[]>()
  for (const a of g.arestas) saem.set(a.de, [...(saem.get(a.de) ?? []), a.para])

  const vistos = new Set<string>([de])
  const fila = [de]
  while (fila.length > 0) {
    const atual = fila.shift()!
    for (const seguinte of saem.get(atual) ?? []) {
      if (seguinte === para) return true
      if (vistos.has(seguinte)) continue
      vistos.add(seguinte)
      fila.push(seguinte)
    }
  }
  return false
}

test('todo caminho que o motor percorre existe no desenho', () => {
  // O teste central deste módulo. Roda o motor de verdade, com as cinco
  // personas, e confere que dá para ir de cada etapa visitada até a seguinte
  // andando pelas arestas desenhadas. Se o motor mudar de caminho e o desenho
  // não acompanhar, quebra aqui — e não numa revisão de fluxo que decide ligar
  // para alguém.
  const g = aplanar(COMPLETO)
  const existe = new Set(g.nos.map((n) => n.id))

  for (const persona of Object.keys(PERSONAS) as Persona[]) {
    const caminho = simular(COMPLETO, persona)
      .eventos.map((ev) => ev.etapaId)
      .filter((id) => existe.has(id))

    for (let i = 0; i < caminho.length - 1; i++) {
      const de = caminho[i]!
      const para = caminho[i + 1]!
      if (de === para) continue // a mesma etapa emitindo dois eventos
      assert.ok(
        alcanca(g, de, para),
        `persona ${persona}: o motor foi de ${de} até ${para}, e o desenho não liga os dois`,
      )
    }
  }
})

test('toda etapa visitada pelo motor existe como nó', () => {
  const g = aplanar(COMPLETO)
  const existe = new Set(g.nos.map((n) => n.id))
  for (const persona of Object.keys(PERSONAS) as Persona[]) {
    for (const ev of simular(COMPLETO, persona).eventos) {
      // `—` é o marcador do simulador para evento que não pertence a etapa
      // nenhuma, como o "fim do fluxo".
      if (ev.etapaId === '—') continue
      assert.ok(existe.has(ev.etapaId), `persona ${persona}: etapa ${ev.etapaId} não está no desenho`)
    }
  }
})

test('a junção é o que torna o ramo alcançável adiante', () => {
  // Guarda contra a regressão mais provável: alguém "simplifica" o achatador
  // tirando a aresta de junção, e o teste acima passaria a falhar por um
  // motivo difícil de ler. Este falha dizendo exatamente o que sumiu.
  const g = aplanar(COMPLETO)
  assert.ok(alcanca(g, 'sms', 'entrega'), 'quem entra pelo ramo não pode ficar preso nele')
  assert.ok(alcanca(g, 'agenda', 'entrega'))
})

/* --------------------- O caminho percorrido, preenchido -------------------- */

test('a guarda atravessada entra no caminho, mesmo sem emitir evento', () => {
  // O bug que isto conserta: a tela esmaecia a guarda como se o lead não
  // tivesse passado por ela — quando foi ela que decidiu deixá-lo seguir.
  const g = aplanar(COMPLETO)
  const percorrido = preencherPercurso(g, ['wa', 'liga'])
  assert.ok(percorrido.has('entrada'), 'a entrada é por onde todo lead passa')
  assert.ok(percorrido.has('guarda'), 'a guarda foi atravessada')
  assert.ok(percorrido.has('cond'), 'a condição decidiu em silêncio, mas decidiu')
})

test('o que ficou fora do caminho continua fora', () => {
  const g = aplanar(COMPLETO)
  const percorrido = preencherPercurso(g, ['wa', 'liga'])
  assert.equal(percorrido.has('sms'), false, 'o outro ramo não foi percorrido')
})

test('sem simulação, ninguém é marcado', () => {
  // Zero é diferente de "tudo apagado": antes de simular, nada se esmaece.
  assert.equal(preencherPercurso(aplanar(COMPLETO), []).size, 0)
})

test('id que não existe no desenho é ignorado, não quebra', () => {
  // O `—` do simulador, e qualquer id de uma versão anterior do fluxo.
  const g = aplanar(COMPLETO)
  assert.equal(preencherPercurso(g, ['—', 'fantasma']).size, 0)
  assert.ok(preencherPercurso(g, ['—', 'wa']).has('wa'))
})

test('o caminho preenchido bate com o que o motor executou', () => {
  // Fecha o ciclo: todo nó marcado precisa ser alcançável a partir da entrada,
  // senão o preenchimento estaria acendendo etapa que o lead não viu.
  const g = aplanar(COMPLETO)
  for (const persona of Object.keys(PERSONAS) as Persona[]) {
    const emitidas = simular(COMPLETO, persona).eventos.map((ev) => ev.etapaId)
    for (const id of preencherPercurso(g, emitidas)) {
      if (id === 'entrada') continue
      assert.ok(
        alcanca(g, 'entrada', id),
        `persona ${persona}: ${id} foi marcado como percorrido e não é alcançável da entrada`,
      )
    }
  }
})
