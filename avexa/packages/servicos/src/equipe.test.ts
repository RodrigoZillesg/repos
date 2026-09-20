import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import type { Db } from '@avexa/db'
import { convidarUsuario, definirAtivo } from './equipe.ts'

/** Convidar alguém é decidir quem enxerga os leads de uma empresa. Os testes
 *  aqui cobrem as formas de errar isso em silêncio — as que não dão erro na
 *  hora, só uma tela vazia ou uma porta aberta depois. */

interface Gravado {
  inserido: Record<string, unknown> | null
  atualizado: Record<string, unknown> | null
}

/** Banco de mentira. `existente` é o que uma busca por e-mail ou id devolve;
 *  `admins` é o que a contagem de outros admins ativos devolve. */
function bancoCom(
  existente: Record<string, unknown> | null,
  admins: Array<{ id: string }> = [],
): Db & { g: Gravado } {
  const g: Gravado = { inserido: null, atualizado: null }
  const db = {
    g,
    select: () => ({
      from: () => ({
        where: (() => {
          const r = Object.assign(
            // Sem `.limit()`: é a contagem de outros admins ativos.
            Promise.resolve(admins),
            { limit: async () => (existente ? [existente] : []) },
          )
          return () => r
        })(),
      }),
    }),
    insert: () => ({
      values: (v: Record<string, unknown>) => {
        g.inserido = v
        return { returning: async () => [{ id: 'novo-id', clienteId: null, ...v }] }
      },
    }),
    update: () => ({
      set: (v: Record<string, unknown>) => {
        g.atualizado = v
        return { where: async () => undefined }
      },
    }),
  }
  return db as unknown as Db & { g: Gravado }
}

const CONVITE = { email: 'Ana@Cliente.com ', nome: ' Ana ', papel: 'cliente' as const }

test('o e-mail é normalizado: é a chave de acesso e não pode duplicar por caixa', async () => {
  const d = bancoCom(null)
  const r = await convidarUsuario(d, { ...CONVITE, clienteId: 'cli-1' })
  assert.ok(r.ok)
  assert.equal(d.g.inserido!.email, 'ana@cliente.com')
  assert.equal(d.g.inserido!.nome, 'Ana')
})

test('cliente sem vínculo é recusado: entraria numa tela vazia, sem erro nenhum', async () => {
  const r = await convidarUsuario(bancoCom(null), { ...CONVITE, papel: 'cliente' })
  assert.equal(r.ok, false)
  assert.match(r.ok === false ? r.erro : '', /ligado a um cliente/)
})

test('papel interno com vínculo também é recusado: sugere um escopo que não existe', async () => {
  // Um admin com clienteId enxerga tudo, mas a lista diria que ele é daquele
  // cliente. Quem for auditar acesso depois confia na lista.
  const r = await convidarUsuario(bancoCom(null), {
    email: 'op@avexa.global',
    nome: 'Op',
    papel: 'operacao',
    clienteId: 'cli-1',
  })
  assert.equal(r.ok, false)
  assert.match(r.ok === false ? r.erro : '', /não é ligado a um cliente/)
})

test('papel interno nunca grava clienteId, mesmo se vier no formulário', async () => {
  const d = bancoCom(null)
  const r = await convidarUsuario(d, { email: 'op@avexa.global', nome: 'Op', papel: 'operacao' })
  assert.ok(r.ok)
  assert.equal(d.g.inserido!.clienteId, null)
})

test('e-mail já em uso não vira segundo usuário', async () => {
  const r = await convidarUsuario(bancoCom({ id: 'u1', email: 'ana@cliente.com', ativo: true }), {
    ...CONVITE,
    clienteId: 'cli-1',
  })
  assert.equal(r.ok, false)
  assert.match(r.ok === false ? r.erro : '', /já tem acesso/)
})

test('usuário desativado dá a instrução certa, não um "já existe" enigmático', async () => {
  // É o caso mais confuso: o admin convida, leva erro, e sem esta mensagem não
  // descobre que basta reativar.
  const r = await convidarUsuario(bancoCom({ id: 'u1', email: 'ana@cliente.com', ativo: false }), {
    ...CONVITE,
    clienteId: 'cli-1',
  })
  assert.equal(r.ok, false)
  assert.match(r.ok === false ? r.erro : '', /Reative/)
})

test('endereço sem arroba não entra: é a chave de acesso, não um rótulo', async () => {
  const r = await convidarUsuario(bancoCom(null), {
    email: 'ana',
    nome: 'Ana',
    papel: 'operacao',
  })
  assert.equal(r.ok, false)
})

test('convite sem nome é recusado: o e-mail de entrada cumprimenta alguém', async () => {
  const r = await convidarUsuario(bancoCom(null), {
    email: 'ana@cliente.com',
    nome: '   ',
    papel: 'operacao',
  })
  assert.equal(r.ok, false)
})

test('desativar marca inativo em vez de apagar', async () => {
  const d = bancoCom({ id: 'u1', papel: 'operacao' })
  const r = await definirAtivo(d, 'u1', false)
  assert.equal(r.ok, true)
  assert.deepEqual(d.g.atualizado, { ativo: false })
})

test('o último admin ativo não pode ser desativado: trancaria o painel', async () => {
  // Não há tela para desfazer isso — só acesso ao banco.
  const d = bancoCom({ id: 'u1', papel: 'admin' }, [])
  const r = await definirAtivo(d, 'u1', false)
  assert.equal(r.ok, false)
  assert.equal(d.g.atualizado, null)
})

test('havendo outro admin ativo, desativar é permitido', async () => {
  const d = bancoCom({ id: 'u1', papel: 'admin' }, [{ id: 'u2' }])
  assert.equal((await definirAtivo(d, 'u1', false)).ok, true)
})

test('reativar um admin nunca esbarra na proteção do último', async () => {
  const d = bancoCom({ id: 'u1', papel: 'admin' }, [])
  assert.equal((await definirAtivo(d, 'u1', true)).ok, true)
  assert.deepEqual(d.g.atualizado, { ativo: true })
})
