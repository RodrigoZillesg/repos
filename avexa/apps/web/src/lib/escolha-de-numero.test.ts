import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { capacidadesExigidas, escolher, servem } from './escolha-de-numero.ts'

const n = (e164: string, capacidades: string[]) => ({ e164, capacidades })

test('sem canal de telefone, nenhuma capacidade é exigida', () => {
  assert.deepEqual(capacidadesExigidas({}), [])
  assert.deepEqual(capacidadesExigidas({ ligacao: false, sms: false }), [])
})

test('ligação exige voz; SMS exige sms; os dois exigem os dois', () => {
  assert.deepEqual(capacidadesExigidas({ ligacao: true }), ['voz'])
  assert.deepEqual(capacidadesExigidas({ sms: true }), ['sms'])
  assert.deepEqual(capacidadesExigidas({ ligacao: true, sms: true }), ['voz', 'sms'])
})

test('só serve quem tem todas as capacidades exigidas', () => {
  const livres = [n('+1', ['voz']), n('+2', ['voz', 'sms']), n('+3', [])]
  assert.deepEqual(servem(livres, ['voz', 'sms']).map((x) => x.e164), ['+2'])
  assert.deepEqual(servem(livres, ['voz']).map((x) => x.e164), ['+1', '+2'])
  assert.deepEqual(servem(livres, []).map((x) => x.e164), ['+1', '+2', '+3'])
})

test('o escolhido que continua servindo é mantido', () => {
  assert.equal(escolher('+2', [n('+1', []), n('+2', [])]), '+2')
})

test('o escolhido que saiu da lista cai no primeiro que serve', () => {
  assert.equal(escolher('+9', [n('+1', []), n('+2', [])]), '+1')
})

test('lista vazia com campo vazio devolve EXATAMENTE o mesmo valor', () => {
  // Esta é a invariante que travou a tela de ativação. A função é lida dentro
  // de um efeito: se ela devolvesse um valor "novo" aqui, o estado mudaria de
  // identidade, o componente renderizaria, o efeito rodaria de novo, e o menu
  // inteiro pararia de responder. Já aconteceu.
  const atual = ''
  const r = escolher(atual, [])
  assert.equal(r, atual)
  assert.ok(Object.is(r, atual), 'precisa ser o mesmo valor, não um equivalente')
})

test('lista vazia com campo preenchido limpa o campo', () => {
  // Aqui MUDAR é o certo: o número escolhido não está mais disponível, e
  // deixá-lo no formulário mandaria a ativação tentar usar o que não existe.
  assert.equal(escolher('+9', []), '')
})

test('chamar duas vezes seguidas devolve o mesmo: a decisão estabiliza', () => {
  // Sem estabilidade não há como sair do efeito, qualquer que seja o estado.
  const casos: Array<[string, Array<{ e164: string }>]> = [
    ['', []],
    ['+9', []],
    ['+1', [n('+1', [])]],
    ['+9', [n('+1', [])]],
  ]
  for (const [atual, uteis] of casos) {
    const uma = escolher(atual, uteis)
    assert.equal(escolher(uma, uteis), uma, `não estabilizou para ${atual || '(vazio)'}`)
  }
})
