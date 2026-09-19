import { strict as assert } from 'node:assert'
import { afterEach, test } from 'node:test'
import { basePublica } from './url.ts'

const original = process.env.DOMINIO
afterEach(() => {
  if (original === undefined) delete process.env.DOMINIO
  else process.env.DOMINIO = original
})

const cab = (o: Record<string, string> = {}) => new Headers(o)

test('em produção a base vem do DOMINIO, não da URL da requisição', () => {
  process.env.DOMINIO = 'new.avexa.global'
  // É assim que o Next monta req.url atrás do proxy: o endereço onde o
  // processo escuta. Foi isto que quebrou o primeiro login em produção.
  const base = basePublica(cab({ host: 'new.avexa.global' }), 'http://0.0.0.0:3000/entrar/confirmar?t=x')
  assert.equal(base, 'https://new.avexa.global')
})

test('um Host forjado não muda para onde o painel redireciona', () => {
  process.env.DOMINIO = 'new.avexa.global'
  const base = basePublica(cab({ host: 'malicioso.example', 'x-forwarded-host': 'malicioso.example' }))
  assert.equal(base, 'https://new.avexa.global')
})

test('sem DOMINIO, usa o que o proxy repassou', () => {
  delete process.env.DOMINIO
  const base = basePublica(cab({ host: 'painel.local', 'x-forwarded-proto': 'https' }))
  assert.equal(base, 'https://painel.local')
})

test('x-forwarded-host ganha do host, e só o primeiro salto conta', () => {
  delete process.env.DOMINIO
  const base = basePublica(
    cab({ host: 'interno:3000', 'x-forwarded-host': 'painel.local, interno', 'x-forwarded-proto': 'https, http' }),
  )
  assert.equal(base, 'https://painel.local')
})

test('sem domínio e sem proxy, cai na URL da requisição', () => {
  delete process.env.DOMINIO
  assert.equal(basePublica(cab(), 'http://localhost:3000/entrar'), 'http://localhost:3000')
})

test('barra sobrando no DOMINIO não vira barra dupla no link', () => {
  process.env.DOMINIO = 'new.avexa.global/'
  assert.equal(`${basePublica(cab())}/entrar`, 'https://new.avexa.global/entrar')
})
