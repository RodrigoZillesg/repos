import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import type { Db } from '@avexa/db'
import { definirCanal, salvarCliente } from './canais.ts'

/** Ligar um canal sem o pré-requisito é o erro que não dá erro: o painel diz
 *  que está ativo, o fluxo tem a etapa, e nenhum contato sai. Estes testes
 *  prendem a recusa. */

interface Estado {
  canais: Array<{ canal: string; ativo: boolean; config: Record<string, unknown> }>
  agente: Array<{ vapiAssistantId: string | null }>
  publicados: Array<{ grafo: unknown }>
  gravado: Record<string, unknown> | null
}

/** Banco de mentira encadeável.
 *
 *  As três consultas de `estadoDosCanais` têm formas diferentes — uma termina
 *  em `.where()`, outra em `.limit()`, a terceira passa por `.innerJoin()`.
 *  Então cada elo devolve a si mesmo, e o resultado só é consumido quando
 *  alguém dá `await`: é aí que a fila avança. */
function bancoCom(e: Estado): Db {
  // A quarta é a busca da linha do canal, já em `definirCanal`. Sem ela o
  // código acharia que a linha não existe e iria pelo caminho de inserir.
  const fila = [e.canais, e.agente, e.publicados, [{ id: 'cc-1' }]]
  let i = 0

  const elo = (): unknown => {
    const self: Record<string, unknown> = {}
    for (const m of ['from', 'where', 'innerJoin', 'limit', 'orderBy']) self[m] = () => elo()
    // Thenable: `await` em qualquer ponto da cadeia entrega a próxima resposta.
    self.then = (resolver: (v: unknown) => void) => resolver(fila[i++] ?? [])
    return self
  }

  return {
    select: () => elo(),
    update: () => ({
      set: (v: Record<string, unknown>) => {
        e.gravado = v
        return { where: async () => undefined }
      },
    }),
    insert: () => ({
      values: async (v: Record<string, unknown>) => {
        e.gravado = v
      },
    }),
  } as unknown as Db
}

const semNada = (): Estado => ({
  canais: [
    { canal: 'ligacao', ativo: false, config: {} },
    { canal: 'whatsapp', ativo: false, config: {} },
    { canal: 'sms', ativo: false, config: {} },
    { canal: 'email', ativo: true, config: {} },
  ],
  agente: [],
  publicados: [],
  gravado: null,
})

const comNumero = (): Estado => {
  const e = semNada()
  e.canais = e.canais.map((c) =>
    c.canal === 'sms' || c.canal === 'ligacao'
      ? { ...c, config: { numero: '+61255500101' } }
      : c,
  )
  return e
}

test('SMS sem número é recusado: a etapa seria pulada em silêncio', async () => {
  const e = semNada()
  const r = await definirCanal(bancoCom(e), 'cli', 'sms', true)
  assert.equal(r.ok, false)
  assert.match(r.ok === false ? r.erro : '', /não tem número/)
  assert.equal(e.gravado, null, 'nada foi gravado')
})

test('SMS com número é ligado', async () => {
  const e = comNumero()
  const r = await definirCanal(bancoCom(e), 'cli', 'sms', true)
  assert.equal(r.ok, true)
  assert.deepEqual(e.gravado, { ativo: true })
})

test('ligação com número mas sem agente publicado é recusada', async () => {
  // Número no Twilio não basta: sem assistente na Vapi a chamada não sai.
  const e = comNumero()
  const r = await definirCanal(bancoCom(e), 'cli', 'ligacao', true)
  assert.equal(r.ok, false)
  assert.match(r.ok === false ? r.erro : '', /agente de voz/)
})

test('ligação com agente publicado mas número fora da Vapi é recusada', async () => {
  // A Vapi identifica número por id próprio. Comprar no Twilio não basta.
  const e = comNumero()
  e.agente = [{ vapiAssistantId: 'asst_1' }]
  const r = await definirCanal(bancoCom(e), 'cli', 'ligacao', true)
  assert.equal(r.ok, false)
  assert.match(r.ok === false ? r.erro : '', /importado na Vapi/)
})

test('ligação com tudo pronto é ligada', async () => {
  const e = comNumero()
  e.agente = [{ vapiAssistantId: 'asst_1' }]
  e.canais = e.canais.map((c) =>
    c.canal === 'ligacao' ? { ...c, config: { ...c.config, vozId: 'pn_1' } } : c,
  )
  const r = await definirCanal(bancoCom(e), 'cli', 'ligacao', true)
  assert.equal(r.ok, true)
})

test('WhatsApp e e-mail não pedem número: saem do remetente da Avexa', async () => {
  for (const canal of ['whatsapp', 'email'] as const) {
    const e = semNada()
    assert.equal((await definirCanal(bancoCom(e), 'cli', canal, true)).ok, true, canal)
  }
})

test('desligar nunca é recusado, nem sem pré-requisito', async () => {
  // Quem decide o que contratou é o cliente. E um canal que não dá para ligar
  // tem ainda mais motivo para poder ser desligado.
  const e = semNada()
  e.canais = e.canais.map((c) => (c.canal === 'email' ? { ...c, ativo: true } : c))
  const r = await definirCanal(bancoCom(e), 'cli', 'email', false)
  assert.equal(r.ok, true)
  assert.deepEqual(e.gravado, { ativo: false })
})

test('desligar avisa quando há fluxo publicado dependendo do canal', async () => {
  // A consequência acontece na próxima entrada de lead, não na hora do clique.
  const e = semNada()
  e.publicados = [
    { grafo: [{ id: '1', tipo: 'entrada', cfg: {} }, { id: '2', tipo: 'email', cfg: {} }] },
  ]
  const r = await definirCanal(bancoCom(e), 'cli', 'email', false)
  assert.equal(r.ok, true)
  assert.match(r.ok === true ? (r.aviso ?? '') : '', /1 fluxo publicado|Um fluxo publicado/)
})

test('etapa de canal dentro de um ramo também conta', async () => {
  // Varrer só o tronco diria "nenhum fluxo usa", e desligar calaria o ramo.
  const e = semNada()
  e.publicados = [
    {
      grafo: [
        { id: '1', tipo: 'entrada', cfg: {} },
        { id: '2', tipo: 'condicao', cfg: {}, sim: [{ id: 's', tipo: 'email', cfg: {} }], nao: [] },
      ],
    },
  ]
  const r = await definirCanal(bancoCom(e), 'cli', 'email', false)
  assert.ok(r.ok === true && r.aviso, 'o ramo foi visto')
})

test('ligar um canal que já está ligado não faz nada', async () => {
  const e = semNada()
  const r = await definirCanal(bancoCom(e), 'cli', 'email', true)
  assert.equal(r.ok, true)
  assert.equal(e.gravado, null)
})

/* -------------------------------- Cadastro -------------------------------- */

const bancoSimples = (): { db: Db; gravado: Record<string, unknown> | null } => {
  const caixa: { gravado: Record<string, unknown> | null } = { gravado: null }
  const db = {
    update: () => ({
      set: (v: Record<string, unknown>) => {
        caixa.gravado = v
        return { where: async () => undefined }
      },
    }),
  } as unknown as Db
  return { db, get gravado() { return caixa.gravado } }
}

const CADASTRO = { nome: 'Cliente', fusoHorario: 'Australia/Sydney', pais: 'AU', dryRun: true }

test('fuso inválido é recusado: decidiria a janela de contato errada', async () => {
  // Ligar às 3 da manhã na casa de alguém.
  const b = bancoSimples()
  const r = await salvarCliente(b.db, 'cli', { ...CADASTRO, fusoHorario: 'Marte/Olympus' })
  assert.equal(r.ok, false)
  assert.equal(b.gravado, null)
})

test('país precisa ser sigla de duas letras', async () => {
  const b = bancoSimples()
  assert.equal((await salvarCliente(b.db, 'cli', { ...CADASTRO, pais: 'Brasil' })).ok, false)
})

test('nome em branco é recusado', async () => {
  const b = bancoSimples()
  assert.equal((await salvarCliente(b.db, 'cli', { ...CADASTRO, nome: '  ' })).ok, false)
})

test('desligar o modo seco avisa que os contatos passam a sair de verdade', async () => {
  const b = bancoSimples()
  const r = await salvarCliente(b.db, 'cli', { ...CADASTRO, dryRun: false })
  assert.equal(r.ok, true)
  assert.match(r.ok === true ? (r.aviso ?? '') : '', /de verdade/)
})
