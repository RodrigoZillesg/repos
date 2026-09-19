/** Integração Google de ponta a ponta, contra um Google falso.
 *
 *  Não precisa de credencial real: o que se quer provar aqui é o nosso lado —
 *  que o refresh token não encosta no banco em claro, que a renovação preserva
 *  o token quando o Google não manda outro, que um acesso revogado desliga a
 *  integração em vez de tentar para sempre, e que o agendamento cai num horário
 *  livre dentro da janela do lead. */
import { eq } from 'drizzle-orm'
import { cliente, db, integracao } from '@avexa/db'
import {
  agendarReuniao,
  concluirConexao,
  conexaoValida,
  definirDestino,
  encerrarFila,
  registrarNaPlanilha,
} from '@avexa/servicos'
import { LIMITES_PADRAO } from '@avexa/core'

process.env.APP_SECRET ??= 'chave-de-teste-com-mais-de-trinta-e-dois-caracteres'
process.env.GOOGLE_CLIENT_ID ??= 'teste.apps.googleusercontent.com'
process.env.GOOGLE_CLIENT_SECRET ??= 'segredo-de-teste'

const REFRESH = '1//refresh-token-secretissimo'
let revogado = false
const chamadas: string[] = []
let eventoCriado: Record<string, unknown> | null = null
let linhaPlanilha: unknown[] | null = null

/** Google de mentira. Só os endpoints que usamos. */
const original = globalThis.fetch
globalThis.fetch = (async (entrada: string | URL | Request, init?: RequestInit) => {
  const url = String(entrada)
  chamadas.push(url.split('?')[0]!)
  const json = (corpo: unknown, status = 200) =>
    ({ ok: status < 300, status, text: async () => JSON.stringify(corpo) }) as Response

  if (url.startsWith('https://oauth2.googleapis.com/token')) {
    const corpo = new URLSearchParams(String(init?.body))
    if (corpo.get('grant_type') === 'authorization_code') {
      return json({ access_token: 'ya29.primeiro', refresh_token: REFRESH, expires_in: 3600, scope: 'cal' })
    }
    if (revogado) return json({ error: 'invalid_grant', error_description: 'Token revoked' }, 400)
    // Renovação sem refresh_token: é o comportamento normal do Google.
    return json({ access_token: 'ya29.renovado', expires_in: 3600, scope: 'cal' })
  }
  if (url.startsWith('https://oauth2.googleapis.com/revoke')) return json({})

  if (url.startsWith('https://www.googleapis.com/calendar/v3/freeBusy')) {
    return json({
      calendars: {
        'ana@cliente.com': {
          // Ocupada a manhã inteira do primeiro dia útil.
          busy: [{ start: '2026-03-10T22:00:00Z', end: '2026-03-11T04:00:00Z' }],
        },
        'bruno@cliente.com': { busy: [] },
        'carla@cliente.com': { errors: [{ reason: 'notFound' }] },
      },
    })
  }
  if (url.includes('/calendar/v3/calendars/')) {
    eventoCriado = JSON.parse(String(init?.body)) as Record<string, unknown>
    return json({ id: 'ev-1', htmlLink: 'https://calendar.google.com/ev-1', hangoutLink: 'https://meet.google.com/abc' })
  }
  if (url.includes('sheets.googleapis.com')) {
    if (init?.method === 'GET') return json({ values: [] })
    if (init?.method === 'PUT') return json({})
    linhaPlanilha = (JSON.parse(String(init?.body)) as { values: unknown[][] }).values[0]!
    return json({ updates: { updatedRange: 'Leads!A2:J2' } })
  }
  return json({}, 404)
}) as typeof fetch

const d = db()
const [c] = await d.select().from(cliente).where(eq(cliente.slug, 'ihte')).limit(1)
if (!c) {
  console.error('rode o seed antes')
  process.exit(1)
}

const problemas: string[] = []

// 1. Consentimento concluído.
const conexao = await concluirConexao(d, c.id, 'google_calendar', 'codigo-do-google')
console.log(`1. conexão: ${conexao.ok ? 'ok' : conexao.erro}`)
if (!conexao.ok) problemas.push('a conexão falhou')

// 2. O refresh token não pode estar em claro no banco.
const [linha] = await d
  .select()
  .from(integracao)
  .where(eq(integracao.clienteId, c.id))
  .limit(50)
  .then((rs) => rs.filter((r) => r.tipo === 'google_calendar'))

const segredo = linha?.segredo ?? ''
console.log(`2. segredo gravado: ${segredo.slice(0, 24)}…`)
if (segredo.includes(REFRESH)) problemas.push('o refresh token foi gravado em claro')
if (!segredo.startsWith('v1.')) problemas.push('o segredo não está no formato cifrado')
if (JSON.stringify(linha?.config ?? {}).includes(REFRESH)) {
  problemas.push('o refresh token vazou para a config')
}

// 3. Renovação sem refresh token novo preserva o que temos.
await definirDestino(d, c.id, 'google_calendar', {
  calendarios: ['ana@cliente.com', 'bruno@cliente.com', 'carla@cliente.com'],
  accessToken: 'ya29.velho',
  expiraEm: new Date(Date.now() - 60_000).toISOString(),
})
const renovada = await conexaoValida(d, c.id, 'google_calendar')
console.log(`3. renovação: ${'erro' in renovada ? renovada.erro : renovada.accessToken}`)
if ('erro' in renovada || renovada.accessToken !== 'ya29.renovado') {
  problemas.push('a renovação não devolveu o token novo')
}

// 4. Agendamento: rodízio, pulando quem está ocupado e quem não compartilhou.
const r = await agendarReuniao(d, {
  clienteId: c.id,
  titulo: 'Conversa sobre o curso',
  duracaoMin: 30,
  lembreteMin: 60,
  emailDoLead: 'lead@exemplo.com',
  fusoDoLead: 'Australia/Sydney',
  limites: LIMITES_PADRAO,
  rodizio: true,
  de: new Date('2026-03-10T22:00:00Z'), // 09:00 de quarta em Sydney
  agora: new Date('2026-03-10T22:00:00Z'),
})

if (r.ok) {
  console.log(`4. agendado com ${r.consultor} em ${r.inicio.toISOString()} · meet: ${r.meet}`)
  if (r.consultor !== 'bruno@cliente.com') {
    problemas.push(`esperava bruno (ana ocupada, carla não compartilhou), veio ${r.consultor}`)
  }
  const corpo = eventoCriado as { attendees?: Array<{ email: string }>; reminders?: { overrides?: unknown[] } }
  if (corpo?.attendees?.[0]?.email !== 'lead@exemplo.com') problemas.push('o lead não foi convidado')
  if (!corpo?.reminders?.overrides?.length) problemas.push('o lembrete não foi configurado')
} else {
  console.log(`4. agendamento falhou: ${r.erro}`)
  problemas.push('o agendamento falhou')
}

// 5. Planilha.
await concluirConexao(d, c.id, 'google_sheets', 'codigo')
await definirDestino(d, c.id, 'google_sheets', { planilhaId: 'plan-1', aba: 'Leads' })
const planilha = await registrarNaPlanilha(d, c.id, ['2026-03-10', 'Ana', '+61...', 'a@b.com', 82])
console.log(`5. planilha: ${planilha.ok ? `linha escrita (${(linhaPlanilha ?? []).length} colunas)` : planilha.erro}`)
if (!planilha.ok) problemas.push('a planilha não recebeu a linha')

// 6. Acesso revogado desliga a integração em vez de insistir.
revogado = true
await definirDestino(d, c.id, 'google_calendar', {
  expiraEm: new Date(Date.now() - 60_000).toISOString(),
})
const depois = await conexaoValida(d, c.id, 'google_calendar')
console.log(`6. revogado: ${'erro' in depois ? depois.erro : 'ainda conectado'}`)
if (!('erro' in depois) || !depois.precisaReconectar) {
  problemas.push('acesso revogado não pediu reconexão')
}
const [final] = await d
  .select()
  .from(integracao)
  .where(eq(integracao.clienteId, c.id))
  .then((rs) => rs.filter((x) => x.tipo === 'google_calendar'))
if (final?.ativo) problemas.push('a integração revogada continuou ativa')

globalThis.fetch = original
console.log('')
if (problemas.length > 0) {
  console.log('❌ FALHOU:')
  for (const p of problemas) console.log(`   ${p}`)
} else {
  console.log('✅ segredo cifrado, renovação preservando o token, rodízio correto,')
  console.log('   planilha escrita e revogação desligando a integração')
}
await encerrarFila()
process.exit(problemas.length > 0 ? 1 : 0)
