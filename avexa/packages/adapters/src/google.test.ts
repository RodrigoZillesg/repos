import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  ESCOPOS,
  acrescentarLinha,
  criarEvento,
  ocupados,
  renovarAcesso,
  trocarCodigo,
  urlDeConsentimento,
} from './google.ts'

function fetchFalso(respostas: Array<{ status?: number; corpo?: unknown }>) {
  const chamadas: Array<{ url: string; init: RequestInit }> = []
  let i = 0
  const buscar = (async (url: string | URL | Request, init?: RequestInit) => {
    chamadas.push({ url: String(url), init: init ?? {} })
    const r = respostas[Math.min(i++, respostas.length - 1)] ?? {}
    const status = r.status ?? 200
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => JSON.stringify(r.corpo ?? {}),
    } as Response
  }) as typeof fetch
  return { buscar, chamadas }
}

const cfg = {
  clientId: 'id.apps.googleusercontent.com',
  clientSecret: 'segredo',
  redirectUri: 'https://app.avexa.global/api/integracoes/google/retorno',
}

test('a URL de consentimento pede acesso offline e força a tela', () => {
  // Sem access_type=offline + prompt=consent, uma reconexão volta sem refresh
  // token: o cliente parece conectado e para de funcionar em uma hora.
  const u = new URL(urlDeConsentimento(cfg, ESCOPOS.google_calendar, 'estado-assinado'))
  assert.equal(u.searchParams.get('access_type'), 'offline')
  assert.equal(u.searchParams.get('prompt'), 'consent')
  assert.equal(u.searchParams.get('state'), 'estado-assinado')
  assert.equal(u.searchParams.get('redirect_uri'), cfg.redirectUri)
  assert.match(u.searchParams.get('scope')!, /calendar\.events/)
})

test('pede só os escopos que usa', () => {
  assert.deepEqual(ESCOPOS.google_sheets, ['https://www.googleapis.com/auth/spreadsheets'])
  // Nunca o escopo amplo `/auth/calendar`, que dá acesso a criar e apagar
  // agendas inteiras do cliente.
  assert.equal(
    (ESCOPOS.google_calendar as readonly string[]).includes('https://www.googleapis.com/auth/calendar'),
    false,
  )
})

test('a troca do código devolve credenciais com validade', async () => {
  const f = fetchFalso([
    { corpo: { access_token: 'ya29.x', refresh_token: '1//r', expires_in: 3600, scope: 'a b' } },
  ])
  const r = await trocarCodigo({ ...cfg, buscar: f.buscar }, 'codigo')
  assert.ok(!('erro' in r))
  if ('erro' in r) return
  assert.equal(r.accessToken, 'ya29.x')
  assert.equal(r.refreshToken, '1//r')
  assert.deepEqual(r.escopos, ['a', 'b'])
  // Um minuto de folga, para não perder a corrida com a chamada seguinte.
  const faltam = (r.expiraEm.getTime() - Date.now()) / 1000
  assert.ok(faltam > 3500 && faltam <= 3540, String(faltam))
  const corpo = new URLSearchParams(String(f.chamadas[0]!.init.body))
  assert.equal(corpo.get('grant_type'), 'authorization_code')
})

test('a renovação mantém o refresh token quando o Google não manda outro', async () => {
  // O Google só reenvia o refresh token em situações específicas; perdê-lo aqui
  // desconectaria o cliente na próxima renovação.
  const f = fetchFalso([{ corpo: { access_token: 'novo', expires_in: 3600 } }])
  const r = await renovarAcesso({ ...cfg, buscar: f.buscar }, '1//antigo')
  assert.ok(!('erro' in r))
  if ('erro' in r) return
  assert.equal(r.refreshToken, '1//antigo')
})

test('invalid_grant é marcado como revogado: reenviar nunca resolve', async () => {
  const f = fetchFalso([{ status: 400, corpo: { error: 'invalid_grant', error_description: 'Token revoked' } }])
  const r = await renovarAcesso({ ...cfg, buscar: f.buscar }, '1//morto')
  assert.ok('erro' in r)
  if (!('erro' in r)) return
  assert.equal(r.revogado, true)
})

test('calendário não compartilhado fica de fora em vez de entrar como livre', async () => {
  // Tratar "sem permissão" como agenda vazia marcaria reunião em cima de
  // compromisso existente — o erro mais caro que esta integração pode cometer.
  const f = fetchFalso([
    {
      corpo: {
        calendars: {
          'ana@cliente.com': { busy: [{ start: '2026-03-10T12:00:00Z', end: '2026-03-10T13:00:00Z' }] },
          'bruno@cliente.com': { errors: [{ reason: 'notFound' }] },
        },
      },
    },
  ])
  const r = await ocupados('tok', ['ana@cliente.com', 'bruno@cliente.com'], new Date(), new Date(), f.buscar)
  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.deepEqual(Object.keys(r.calendarios), ['ana@cliente.com'])
  assert.equal(r.calendarios['ana@cliente.com']![0]!.inicio.toISOString(), '2026-03-10T12:00:00.000Z')
})

test('o evento avisa os convidados e leva o lembrete pedido', async () => {
  const f = fetchFalso([{ corpo: { id: 'ev1', htmlLink: 'https://cal/ev1', hangoutLink: 'https://meet/x' } }])
  const r = await criarEvento(
    'tok',
    {
      calendarId: 'ana@cliente.com',
      titulo: 'Conversa sobre IELTS',
      inicio: new Date('2026-03-10T12:00:00Z'),
      fim: new Date('2026-03-10T12:30:00Z'),
      fuso: 'Australia/Sydney',
      convidados: ['lead@exemplo.com'],
      lembreteMin: 60,
      comMeet: true,
    },
    f.buscar,
  )
  assert.ok(!('erro' in r))
  if ('erro' in r) return
  assert.equal(r.id, 'ev1')
  assert.equal(r.meet, 'https://meet/x')

  const url = new URL(f.chamadas[0]!.url)
  assert.equal(url.searchParams.get('sendUpdates'), 'all')
  assert.equal(url.searchParams.get('conferenceDataVersion'), '1')
  const corpo = JSON.parse(String(f.chamadas[0]!.init.body))
  assert.equal(corpo.start.timeZone, 'Australia/Sydney')
  assert.deepEqual(corpo.reminders.overrides, [{ method: 'email', minutes: 60 }])
  assert.deepEqual(corpo.attendees, [{ email: 'lead@exemplo.com' }])
})

test('sem lembrete pedido, usa o padrão da agenda do cliente', async () => {
  const f = fetchFalso([{ corpo: { id: 'ev2' } }])
  await criarEvento(
    'tok',
    {
      calendarId: 'c',
      titulo: 't',
      inicio: new Date(),
      fim: new Date(),
      fuso: 'UTC',
      convidados: [],
    },
    f.buscar,
  )
  assert.deepEqual(JSON.parse(String(f.chamadas[0]!.init.body)).reminders, { useDefault: true })
})

test('a planilha recebe a linha no fim, sem sobrescrever nada', async () => {
  const f = fetchFalso([{ corpo: { updates: { updatedRange: 'Leads!A5:E5' } } }])
  const r = await acrescentarLinha('tok', 'plan1', 'Leads', ['Ana', 82, null], f.buscar)
  assert.ok(!('erro' in r))
  const url = new URL(f.chamadas[0]!.url)
  assert.equal(url.searchParams.get('insertDataOption'), 'INSERT_ROWS')
  // null vira string vazia: a API rejeita null no meio dos valores.
  assert.deepEqual(JSON.parse(String(f.chamadas[0]!.init.body)).values, [['Ana', 82, '']])
})
