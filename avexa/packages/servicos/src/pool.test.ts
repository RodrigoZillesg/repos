import { strict as assert } from 'node:assert'
import { test } from 'node:test'

/** Quem pode sair do pool.
 *
 *  O Platty foi ativado, recebeu um número do seed e a Vapi recusou importá-lo:
 *  a conta do Twilio não tem esse número para importar. O erro apareceu três
 *  passos depois da escolha, e apontava para o fornecedor errado.
 *
 *  A regra tem duas partes, nesta ordem: o número precisa EXISTIR na conta, e
 *  precisa FAZER o que os canais contratados pedem. A ordem importa para a
 *  mensagem: "nenhum é real" e "nenhum manda SMS" se resolvem de formas
 *  diferentes. */

interface Livre {
  e164: string
  provedorSid: string | null
  capacidades: string[]
}

/** A mesma peneira do pool da ativação, isolada para poder ser testada. */
function elegiveis(livres: Livre[], precisa: string[]) {
  const reais = livres.filter((n) => Boolean(n.provedorSid))
  return {
    reais,
    servem: reais.filter((n) => precisa.every((c) => n.capacidades.includes(c))),
  }
}

const doSeed: Livre = { e164: '+14155550102', provedorSid: null, capacidades: ['voz', 'sms'] }
const comprado: Livre = { e164: '+61468096362', provedorSid: 'PN1', capacidades: ['voz', 'sms'] }
const soVoz: Livre = { e164: '+61255500999', provedorSid: 'PN2', capacidades: ['voz'] }

test('número sem SID não sai do pool, mesmo dizendo que faz tudo', () => {
  // É o caso do Platty: capacidades completas, e nada por trás delas.
  const r = elegiveis([doSeed], ['voz', 'sms'])
  assert.deepEqual(r.reais, [])
  assert.deepEqual(r.servem, [])
})

test('número comprado e completo sai', () => {
  const r = elegiveis([doSeed, comprado], ['voz', 'sms'])
  assert.deepEqual(r.servem.map((n) => n.e164), ['+61468096362'])
})

test('só de voz não sai para quem contratou SMS, mas é contado como real', () => {
  const r = elegiveis([soVoz], ['voz', 'sms'])
  // A distinção é o que permite dizer "existe, mas não manda SMS" em vez de
  // "não existe" — as duas frases mandam a pessoa fazer coisas diferentes.
  assert.equal(r.reais.length, 1)
  assert.deepEqual(r.servem, [])
})

test('só de voz sai para quem contratou só ligação', () => {
  const r = elegiveis([soVoz], ['voz'])
  assert.deepEqual(r.servem.map((n) => n.e164), ['+61255500999'])
})

test('sem canal de telefone contratado, qualquer número real serve', () => {
  const r = elegiveis([soVoz, comprado], [])
  assert.equal(r.servem.length, 2)
})
