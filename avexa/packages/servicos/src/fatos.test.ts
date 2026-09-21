import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import type { Canal } from '@avexa/core'
import { canalDoProjeto } from './fatos.ts'
import type { Db } from '@avexa/db'

/** Banco de mentira: devolve a linha de cliente_canal que o teste quiser. */
function bancoCom(linha: { ativo: boolean; config: Record<string, unknown> } | null): Db {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => (linha ? [linha] : []),
        }),
      }),
    }),
  } as unknown as Db
}

const CONFIG = { numero: '+61255500101', vozId: 'vapi-123' }

test('SMS sai do número próprio do cliente', async () => {
  const c = await canalDoProjeto(bancoCom({ ativo: true, config: CONFIG }), 'cli', 'sms')
  assert.equal(c.remetente, '+61255500101')
})

test('ligação recebe o número próprio e o id dele na Vapi', async () => {
  const c = await canalDoProjeto(bancoCom({ ativo: true, config: CONFIG }), 'cli', 'ligacao')
  assert.equal(c.remetente, '+61255500101')
  assert.equal(c.vozId, 'vapi-123')
})

test('WhatsApp NUNCA usa número do cliente, nem com config gravada', async () => {
  // O WhatsApp sai do número único da Avexa. Um config.numero gravado por
  // engano aqui não daria erro claro — daria mensagem não entregue, porque a
  // Cloud API só manda pelo phoneNumberId da nossa WABA.
  const c = await canalDoProjeto(bancoCom({ ativo: true, config: CONFIG }), 'cli', 'whatsapp')
  assert.equal(c.remetente, null)
  assert.equal(c.vozId, null)
})

test('e-mail NUNCA usa número do cliente: remetente único, verificado no Resend', async () => {
  const c = await canalDoProjeto(bancoCom({ ativo: true, config: CONFIG }), 'cli', 'email')
  assert.equal(c.remetente, null)
})

test('só a ligação carrega o id da Vapi', async () => {
  const c = await canalDoProjeto(bancoCom({ ativo: true, config: CONFIG }), 'cli', 'sms')
  assert.equal(c.vozId, null)
})

test('cliente sem número atribuído não inventa remetente', async () => {
  const c = await canalDoProjeto(bancoCom({ ativo: true, config: {} }), 'cli', 'sms')
  assert.equal(c.remetente, null)
})

test('número em branco conta como ausente', async () => {
  const c = await canalDoProjeto(bancoCom({ ativo: true, config: { numero: '   ' } }), 'cli', 'sms')
  assert.equal(c.remetente, null)
})

test('canal que não existe para o cliente vem desligado', async () => {
  const c = await canalDoProjeto(bancoCom(null), 'cli', 'sms')
  assert.equal(c.ativo, false)
  assert.equal(c.remetente, null)
})

test('a regra vale para todos os canais, não só os testados acima', async () => {
  const comNumero: Canal[] = ['sms', 'ligacao']
  const semNumero: Canal[] = ['email', 'whatsapp', 'telegram']

  for (const canal of comNumero) {
    const c = await canalDoProjeto(bancoCom({ ativo: true, config: CONFIG }), 'cli', canal)
    assert.equal(c.remetente, '+61255500101', `${canal} deveria usar o número do cliente`)
  }
  for (const canal of semNumero) {
    const c = await canalDoProjeto(bancoCom({ ativo: true, config: CONFIG }), 'cli', canal)
    assert.equal(c.remetente, null, `${canal} NÃO pode usar o número do cliente`)
  }
})
