import { strict as assert } from 'node:assert'
import { createHmac } from 'node:crypto'
import { test } from 'node:test'
import {
  adaptadorCalendly,
  conferirAssinaturaCalendly,
  horariosCalendly,
  interpretarWebhookCalendly,
  linkDeAgendamento,
  tiposDeEvento,
  urlDeConsentimentoCalendly,
} from './calendly.ts'

function fetchFalso(respostas: Array<{ status?: number; corpo?: unknown }>) {
  const chamadas: Array<{ url: string; init: RequestInit }> = []
  let i = 0
  const buscar = (async (url: string | URL | Request, init?: RequestInit) => {
    chamadas.push({ url: String(url), init: init ?? {} })
    const r = respostas[Math.min(i++, respostas.length - 1)] ?? {}
    const status = r.status ?? 200
    return { ok: status < 300, status, text: async () => JSON.stringify(r.corpo ?? {}) } as Response
  }) as typeof fetch
  return { buscar, chamadas }
}

const cfg = {
  clientId: 'id',
  clientSecret: 'segredo',
  redirectUri: 'https://app.avexa.global/api/integracoes/calendly/retorno',
}

test('a URL de consentimento leva o state assinado', () => {
  const u = new URL(urlDeConsentimentoCalendly(cfg, 'estado'))
  assert.equal(u.origin, 'https://auth.calendly.com')
  assert.equal(u.searchParams.get('state'), 'estado')
  assert.equal(u.searchParams.get('response_type'), 'code')
})

test('lista os tipos de evento ativos do usuário', async () => {
  const f = fetchFalso([
    {
      corpo: {
        collection: [
          { uri: 'https://api.calendly.com/event_types/1', name: 'Conversa de 30 min', duration: 30, scheduling_url: 'https://calendly.com/x/30min', active: true },
          { name: 'sem uri' },
        ],
      },
    },
  ])
  const r = await tiposDeEvento('tok', 'https://api.calendly.com/users/me', f.buscar)
  assert.ok(Array.isArray(r))
  if (!Array.isArray(r)) return
  assert.equal(r.length, 1)
  assert.equal(r[0]!.duracaoMin, 30)
  assert.equal(new URL(f.chamadas[0]!.url).searchParams.get('active'), 'true')
})

test('o link de agendamento é de uso único', async () => {
  // Um link reutilizável circulando por aí deixa qualquer pessoa marcar na
  // agenda do cliente.
  const f = fetchFalso([{ corpo: { resource: { booking_url: 'https://calendly.com/d/abc' } } }])
  const r = await linkDeAgendamento('tok', 'https://api.calendly.com/event_types/1', f.buscar)
  assert.deepEqual(r, { url: 'https://calendly.com/d/abc' })
  const corpo = JSON.parse(String(f.chamadas[0]!.init.body))
  assert.equal(corpo.max_event_count, 1)
  assert.equal(corpo.owner_type, 'EventType')
})

test('resposta sem booking_url vira erro, não link vazio', async () => {
  const f = fetchFalso([{ corpo: { resource: {} } }])
  const r = await linkDeAgendamento('tok', 'ev', f.buscar)
  assert.ok('erro' in r)
})

test('a janela de horários respeita o teto de sete dias da API', async () => {
  const f = fetchFalso([{ corpo: { collection: [] } }])
  const de = new Date(Date.now() + 3600_000)
  await horariosCalendly('tok', 'ev', de, new Date(de.getTime() + 30 * 86_400_000), f.buscar)
  const q = new URL(f.chamadas[0]!.url).searchParams
  const dias = (new Date(q.get('end_time')!).getTime() - new Date(q.get('start_time')!).getTime()) / 86_400_000
  assert.ok(dias <= 7, `janela de ${dias} dias`)
})

test('só devolve horários marcados como disponíveis', async () => {
  const f = fetchFalso([
    {
      corpo: {
        collection: [
          { status: 'available', start_time: '2026-03-10T12:00:00Z' },
          { status: 'unavailable', start_time: '2026-03-10T13:00:00Z' },
        ],
      },
    },
  ])
  const r = await horariosCalendly('tok', 'ev', new Date(), new Date(), f.buscar)
  assert.ok(Array.isArray(r))
  if (!Array.isArray(r)) return
  assert.equal(r.length, 1)
})

test('o adaptador de agenda do Calendly nunca marca direto', async () => {
  // A diferença de modelo é o ponto: quem escolhe o horário é o lead.
  const f = fetchFalso([{ corpo: { resource: { booking_url: 'https://calendly.com/d/xyz' } } }])
  const a = adaptadorCalendly({ accessToken: 'tok', tipoDeEventoUri: 'ev', buscar: f.buscar })
  assert.equal(a.marcaDireto, false)

  const r = await a.oferecer({
    titulo: 't',
    duracaoMin: 30,
    emailDoLead: 'lead@exemplo.com',
    fusoDoLead: 'Australia/Sydney',
    de: new Date(),
  })
  assert.equal(r.tipo, 'link')
  if (r.tipo !== 'link') return
  assert.equal(r.url, 'https://calendly.com/d/xyz')
})

/* --------------------------- Assinatura do webhook -------------------------- */

const CHAVE = 'chave-de-assinatura'
const assinarCorpo = (corpo: string, t = Math.floor(Date.now() / 1000)) =>
  `t=${t},v1=${createHmac('sha256', CHAVE).update(`${t}.${corpo}`).digest('hex')}`

test('aceita a assinatura correta sobre o corpo cru', () => {
  const corpo = '{"event":"invitee.created"}'
  assert.equal(conferirAssinaturaCalendly(assinarCorpo(corpo), corpo, CHAVE), true)
})

test('recusa corpo alterado, chave errada e cabeçalho ausente', () => {
  const corpo = '{"event":"invitee.created"}'
  const assinatura = assinarCorpo(corpo)
  assert.equal(conferirAssinaturaCalendly(assinatura, '{"event":"outro"}', CHAVE), false)
  assert.equal(conferirAssinaturaCalendly(assinatura, corpo, 'outra-chave'), false)
  assert.equal(conferirAssinaturaCalendly(null, corpo, CHAVE), false)
  assert.equal(conferirAssinaturaCalendly('sem-formato', corpo, CHAVE), false)
})

test('recusa assinatura velha: um t reaproveitado é replay', () => {
  const corpo = '{"a":1}'
  const antiga = assinarCorpo(corpo, Math.floor(Date.now() / 1000) - 3600)
  assert.equal(conferirAssinaturaCalendly(antiga, corpo, CHAVE), false)
})

test('reserializar o JSON quebra a assinatura, como tem de ser', () => {
  // É por isso que a rota confere sobre o texto cru.
  const cru = '{"event":"invitee.created","payload":{"email":"a@b.com"}}'
  const assinatura = assinarCorpo(cru)
  const reserializado = JSON.stringify(JSON.parse(cru).payload)
  assert.equal(conferirAssinaturaCalendly(assinatura, reserializado, CHAVE), false)
})

/* --------------------------- Leitura do webhook ----------------------------- */

const criado = {
  event: 'invitee.created',
  payload: {
    uri: 'https://api.calendly.com/invitees/1',
    email: 'Lead@Exemplo.COM',
    name: 'Ana Ribeiro',
    status: 'active',
    scheduled_event: {
      uri: 'https://api.calendly.com/scheduled_events/9',
      start_time: '2026-03-12T02:00:00Z',
      end_time: '2026-03-12T02:30:00Z',
    },
  },
}

test('lê a confirmação e normaliza o e-mail do convidado', () => {
  const r = interpretarWebhookCalendly(criado)!
  assert.equal(r.provedor, 'calendly')
  assert.equal(r.emailDoConvidado, 'lead@exemplo.com')
  assert.equal(r.externoId, 'https://api.calendly.com/scheduled_events/9')
  assert.equal(r.inicio.toISOString(), '2026-03-12T02:00:00.000Z')
  assert.equal(r.cancelada, false)
})

test('lê o cancelamento com o motivo', () => {
  const r = interpretarWebhookCalendly({
    ...criado,
    event: 'invitee.canceled',
    payload: { ...criado.payload, status: 'canceled', cancellation: { reason: 'imprevisto' } },
  })!
  assert.equal(r.cancelada, true)
  assert.equal(r.motivoCancelamento, 'imprevisto')
})

test('ignora eventos que não interessam e payload incompleto', () => {
  assert.equal(interpretarWebhookCalendly({ event: 'routing_form_submission.created' }), null)
  assert.equal(interpretarWebhookCalendly({ event: 'invitee.created', payload: { email: 'a@b.com' } }), null)
  assert.equal(interpretarWebhookCalendly(null), null)
})
