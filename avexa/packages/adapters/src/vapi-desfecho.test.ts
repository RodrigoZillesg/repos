import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { adaptadorVapi, segredoDoWebhookVapi } from './vapi.ts'

const SEGREDO = 'segredo-compartilhado-com-a-vapi'
const adaptador = adaptadorVapi({ apiKey: 'k', segredoWebhook: SEGREDO })

/** O adaptador é um AdaptadorCanal genérico, em que interpretarWebhook é
 *  opcional e pode ser assíncrono. Aqui ele existe e é síncrono. */
const interpretar = (corpo: unknown, cabecalhos: Record<string, string> = { 'x-vapi-secret': SEGREDO }) => {
  const r = adaptador.interpretarWebhook!(corpo, cabecalhos)
  assert.ok(!(r instanceof Promise), 'o adaptador da Vapi interpreta de forma síncrona')
  return r
}

/** Um relatório de fim de chamada, no formato que a Vapi manda. */
const relatorio = (m: Record<string, unknown>) => ({
  message: {
    type: 'end-of-call-report',
    call: { id: 'call_1', customer: { number: '+14155550101' } },
    endedReason: 'customer-ended-call',
    durationSeconds: 90,
    ...m,
  },
})

const analise = (structuredData: Record<string, unknown>) => ({ analysis: { structuredData } })

test('o opt-out vem do desfecho do modelo, e suprime', () => {
  const [e] = interpretar(
    relatorio({ transcript: 'lead: não, obrigado', ...analise({ desfecho: 'optout' }) }),
  )
  assert.equal(e!.tipo, 'optout')
})

test('recusar NÃO é opt-out: dizer não a uma oferta não é pedir para nunca mais ser procurado', () => {
  const [e] = interpretar(
    relatorio({ transcript: 'lead: agora não', ...analise({ desfecho: 'recusou' }) }),
  )
  assert.equal(e!.tipo, 'atendida')
})

test('o desfecho estruturado vence a heurística de palavra-chave', () => {
  // O caso que motivou isto: a frase dispara a heurística, mas o lead pediu
  // retorno, não remoção. Sem o desfecho, ele entraria na supressão GLOBAL e
  // nunca mais seria contatado por canal nenhum.
  const transcript =
    'lead: não quero mais falar sobre isso agora, me liga semana que vem'
  const [e] = interpretar(
    relatorio({ transcript, ...analise({ desfecho: 'aceitou' }) }),
  )
  assert.equal(e!.tipo, 'atendida')
})

test('sem desfecho, a heurística ainda vale — e é justamente onde ela erra', () => {
  // Documenta o comportamento de reserva para agente antigo ou análise que
  // falhou. Aqui a mesma frase vira opt-out, que é o motivo de preferirmos o
  // desfecho estruturado sempre que ele existe.
  const transcript = 'lead: não quero mais falar sobre isso agora, me liga semana que vem'
  const [e] = interpretar(relatorio({ transcript }))
  assert.equal(e!.tipo, 'optout')
})

test('ninguém atendeu: a verdade mecânica vence o que o modelo achar', () => {
  const [e] = interpretar(
    relatorio({ endedReason: 'customer-did-not-answer', ...analise({ desfecho: 'aceitou' }) }),
  )
  assert.equal(e!.tipo, 'nao_atendida')
})

test('caixa postal detectada pelo fim da chamada', () => {
  const [e] = interpretar(relatorio({ endedReason: 'voicemail' }))
  assert.equal(e!.tipo, 'caixa_postal')
})

test('desfecho fora da lista é ruído do modelo, não vira evento inventado', () => {
  const [e] = interpretar(
    relatorio({ transcript: 'oi', ...analise({ desfecho: 'ficou_pensando' }) }),
  )
  assert.equal(e!.tipo, 'atendida')
  assert.equal((e!.payload as { desfecho: unknown }).desfecho, null)
})

test('o desfecho e o motivo do modelo viajam no payload', () => {
  const [e] = interpretar(
    relatorio({
      transcript: 'oi',
      ...analise({
        desfecho: 'reuniao_marcada',
        motivo: 'pediu demonstração na terça',
        emailConfirmado: 'lead@exemplo.com',
      }),
    }),
  )
  const p = e!.payload as Record<string, unknown>
  assert.equal(p.desfecho, 'reuniao_marcada')
  assert.equal(p.desfechoMotivo, 'pediu demonstração na terça')
  assert.equal(p.emailConfirmado, 'lead@exemplo.com')
})

test('campo em branco no desfecho não vira string vazia no payload', () => {
  const [e] = interpretar(
    relatorio({ transcript: 'oi', ...analise({ desfecho: 'aceitou', motivo: '   ' }) }),
  )
  assert.equal((e!.payload as { desfechoMotivo: unknown }).desfechoMotivo, null)
})

test('relatório sem o segredo é descartado', () => {
  // O ataque que importa: um POST forjado com desfecho optout poria o número
  // de um lead real na supressão global, em todos os canais.
  const forjado = relatorio({ transcript: 'x', ...analise({ desfecho: 'optout' }) })
  assert.deepEqual(interpretar(forjado, {}), [])
  assert.deepEqual(interpretar(forjado, { 'x-vapi-secret': 'chute' }), [])
})

test('agente publicado sem segredo não vira porta aberta', () => {
  // Um agente criado antes desta checagem existir não tem segredo. Aceitar
  // seria manter a brecha justamente onde ninguém olharia.
  const semSegredo = adaptadorVapi({ apiKey: 'k' })
  const r = semSegredo.interpretarWebhook!(relatorio({ transcript: 'x' }), {
    'x-vapi-secret': 'qualquer',
  })
  assert.deepEqual(r, [])
})

test('a derivação do segredo é estável e depende do APP_SECRET', () => {
  const a = { APP_SECRET: 'x'.repeat(40) }
  const b = { APP_SECRET: 'y'.repeat(40) }
  // Estável: publicar o agente hoje e conferir o webhook amanhã precisa bater.
  assert.equal(segredoDoWebhookVapi(a), segredoDoWebhookVapi(a))
  assert.notEqual(segredoDoWebhookVapi(a), segredoDoWebhookVapi(b))
  // APP_SECRET curto não vira segredo fraco: vira nenhum.
  assert.equal(segredoDoWebhookVapi({ APP_SECRET: 'curto' }), null)
  assert.equal(segredoDoWebhookVapi({}), null)
})
