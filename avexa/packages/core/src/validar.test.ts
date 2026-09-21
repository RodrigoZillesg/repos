import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { temErro, validarGrafo, type ContextoValidacao } from './validar.ts'
import type { Etapa, Grafo } from './tipos.ts'

const e = (id: string, tipo: Etapa['tipo'], cfg: Record<string, string> = {}, extra: Partial<Etapa> = {}): Etapa =>
  ({ id, tipo, cfg, ...extra })

const ctx: ContextoValidacao = {
  canaisAtivos: { ligacao: true, whatsapp: true, sms: true, email: true },
  templatesAprovados: { whatsapp: ['Primeiro contato'], email: ['Retomada'], sms: ['Lembrete'] },
  fluxosDoCliente: [{ id: 'flx-1', nome: 'Recuperação por telefone' }],
}

const valido: Grafo = [
  e('1', 'entrada', {}),
  e('2', 'guarda', {}),
  e('3', 'whatsapp', { modo: 'Template aprovado', template: 'Primeiro contato' }),
  e('4', 'entregar', { destino: 'CRM do cliente' }),
]

test('um fluxo bem formado não tem erro', () => {
  assert.equal(temErro(validarGrafo(valido, ctx)), false)
})

test('fluxo sem entrada não pode ser publicado', () => {
  const g = [e('1', 'whatsapp', { modo: 'Template aprovado', template: 'Primeiro contato' })]
  const a = validarGrafo(g, ctx)
  assert.equal(temErro(a), true)
  assert.match(a[0]!.mensagem, /começar com uma etapa de entrada/)
})

test('template não aprovado impede a publicação', () => {
  const g = [e('1', 'entrada', {}), e('2', 'whatsapp', { modo: 'Template aprovado', template: 'Inventado' })]
  const a = validarGrafo(g, ctx)
  assert.equal(temErro(a), true)
  assert.match(a.find((x) => x.gravidade === 'erro')!.mensagem, /não está aprovado/)
})

test('conversa livre de WhatsApp não exige template', () => {
  // O campo de template só aparece no modo "Template aprovado"; exigir sempre
  // impediria de publicar um fluxo legítimo de conversa aberta.
  const g = [e('1', 'entrada', {}), e('2', 'whatsapp', { modo: 'Conversa livre (janela aberta)' })]
  assert.equal(temErro(validarGrafo(g, ctx)), false)
})

test('canal não contratado é aviso, não erro', () => {
  // O motor pula a etapa e o fluxo continua pelos outros canais.
  const a = validarGrafo(valido, { ...ctx, canaisAtivos: { ...ctx.canaisAtivos, whatsapp: false } })
  assert.equal(temErro(a), false)
  assert.equal(a.some((x) => x.gravidade === 'aviso' && /não contratou/.test(x.mensagem)), true)
})

test('subfluxo apontando para fluxo inexistente é erro', () => {
  const g = [e('1', 'entrada', {}), e('2', 'subfluxo', { alvo: 'Fluxo fantasma' })]
  assert.equal(temErro(validarGrafo(g, ctx)), true)
})

/** Só os achados presos a esta etapa: o grafo mínimo destes testes dispara
 *  avisos de outra natureza (fluxo sem canal, por exemplo). */
const doSubfluxo = (g: Grafo) => validarGrafo(g, ctx).filter((a) => a.etapaId === '2')

test('subfluxo por id não reclama', () => {
  const g = [e('1', 'entrada', {}), e('2', 'subfluxo', { alvo: 'flx-1' })]
  assert.deepEqual(doSubfluxo(g), [])
})

test('subfluxo por NOME ainda funciona, mas avisa que é bomba-relógio', () => {
  // Formato antigo: o select do construtor não tinha `value`, então gravava o
  // texto. Continua sendo aceito para não invalidar fluxo já publicado — mas
  // renomear o fluxo quebraria a chamada em execução, sem erro nenhum.
  const g = [e('1', 'entrada', {}), e('2', 'subfluxo', { alvo: 'Recuperação por telefone' })]
  const achados = doSubfluxo(g)
  assert.equal(temErro(achados), false)
  assert.equal(achados.length, 1)
  assert.equal(achados[0]!.gravidade, 'aviso')
  assert.match(achados[0]!.mensagem, /pelo nome/)
})

test('webhook de saída sem URL válida é erro', () => {
  const g = [e('1', 'entrada', {}), e('2', 'webhookout', { url: 'cliente.com/lead', metodo: 'POST' })]
  assert.equal(temErro(validarGrafo(g, ctx)), true)
})

test('identificador repetido é erro — o motor localiza etapa por id', () => {
  const g = [e('1', 'entrada', {}), e('1', 'espera', { dur: '2 horas' })]
  assert.equal(temErro(validarGrafo(g, ctx)), true)
})

test('valida também dentro de ramos e de repetição', () => {
  const g = [
    e('1', 'entrada', {}),
    e('2', 'condicao', { campo: 'Lead respondeu', op: 'é igual a', valor: 'Sim' }, {
      sim: [e('3', 'email', { template: 'Inexistente' })],
      nao: [e('4', 'encerrar', { motivo: 'Não respondeu' })],
    }),
  ]
  assert.equal(temErro(validarGrafo(g, ctx)), true)
})

test('fluxo sem nenhum canal avisa que nada sai dele', () => {
  const g = [e('1', 'entrada', {}), e('2', 'marcar', { tag: 'frio' }), e('3', 'encerrar', { motivo: 'Fora do perfil' })]
  const a = validarGrafo(g, ctx)
  assert.equal(temErro(a), false)
  assert.equal(a.some((x) => /nenhum contato vai sair/.test(x.mensagem)), true)
})
