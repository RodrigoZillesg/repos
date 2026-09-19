import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { renderizar, variaveisDe } from './template.ts'

test('substitui variáveis e aceita caminho com ponto', () => {
  const r = renderizar('Oi {{nome}}, o curso {{curso.nome}} começa em {{ data }}.', {
    nome: 'Ana',
    curso: { nome: 'IELTS' },
    data: '3 de março',
  })
  assert.equal(r.texto, 'Oi Ana, o curso IELTS começa em 3 de março.')
  assert.deepEqual(r.faltando, [])
})

test('variável ausente vira vazio e é reportada', () => {
  const r = renderizar('Oi {{nome}}, tudo bem? {{unidade}}', { nome: 'Ana' })
  assert.equal(r.texto, 'Oi Ana, tudo bem? ')
  assert.deepEqual(r.faltando, ['unidade'])
})

test('valor do lead não pode injetar outro marcador', () => {
  // O texto fixo é aprovado pela Meta; a variável não. Se a substituição fosse
  // reexaminada, um valor vindo do formulário mudaria a mensagem aprovada.
  const r = renderizar('Oi {{nome}}!', { nome: '{{admin}}', admin: 'SEGREDO' })
  assert.equal(r.texto, 'Oi {{admin}}!')
})

test('lista as variáveis na ordem em que aparecem', () => {
  assert.deepEqual(variaveisDe('{{nome}} fez {{curso}} com {{nome}}'), ['nome', 'curso'])
})
