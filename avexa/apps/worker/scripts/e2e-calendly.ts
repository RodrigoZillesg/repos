/** Integração Calendly de ponta a ponta, contra um Calendly falso.
 *
 *  O Calendly é o caso em que o fornecedor **não** marca: ele devolve um link e
 *  quem escolhe o horário é o lead. Então o que este script prova é o caminho
 *  que não existe no Google — a reunião nasce como oferta, a confirmação chega
 *  por webhook assinado, e é ela que transforma a oferta em reunião de verdade.
 *
 *  Também prova a parte chata e invisível: assinatura conferida sobre o corpo
 *  cru, replay recusado, e a preferência do cliente decidindo qual ferramenta
 *  usar quando as duas estão conectadas. */
import { createHmac } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { cliente, db, integracao, projeto } from '@avexa/db'
import {
  concluirConexaoCalendly,
  concluirConexaoGoogle,
  conexaoCalendly,
  confirmarReuniao,
  definirDestino,
  encerrarFila,
  ingerirLead,
  listarTiposDeEvento,
  oferecerReuniao,
  provedorDoProjeto,
  reunioesDoLead,
} from '@avexa/servicos'
import { conferirAssinaturaCalendly, interpretarWebhookCalendly } from '@avexa/adapters'
import { LIMITES_PADRAO } from '@avexa/core'

process.env.APP_SECRET ??= 'chave-de-teste-com-mais-de-trinta-e-dois-caracteres'
process.env.CALENDLY_CLIENT_ID ??= 'cliente-calendly-de-teste'
process.env.CALENDLY_CLIENT_SECRET ??= 'segredo-de-teste'
process.env.GOOGLE_CLIENT_ID ??= 'teste.apps.googleusercontent.com'
process.env.GOOGLE_CLIENT_SECRET ??= 'segredo-de-teste'

const REFRESH = 'refresh-do-calendly-secretissimo'
const USUARIO = 'https://api.calendly.com/users/U1'
const ORGANIZACAO = 'https://api.calendly.com/organizations/O1'
const TIPO_30 = 'https://api.calendly.com/event_types/E30'
const LINK = 'https://calendly.com/d/abc-def/conversa-30min'
const CHAVE_WEBHOOK = 'chave-de-assinatura-do-webhook-do-calendly'
const EMAIL = 'lead.calendly@exemplo.com'

let revogado = false
let linksPedidos = 0
let ultimoCorpoDoLink: Record<string, unknown> | null = null

/** Calendly de mentira. Só os endpoints que usamos. */
const original = globalThis.fetch
globalThis.fetch = (async (entrada: string | URL | Request, init?: RequestInit) => {
  const url = String(entrada)
  const json = (corpo: unknown, status = 200) =>
    ({ ok: status < 300, status, text: async () => JSON.stringify(corpo) }) as Response

  if (url.startsWith('https://auth.calendly.com/oauth/token')) {
    const corpo = JSON.parse(String(init?.body)) as { grant_type?: string }
    if (corpo.grant_type === 'authorization_code') {
      return json({
        access_token: 'cal.primeiro',
        refresh_token: REFRESH,
        expires_in: 7200,
        owner: USUARIO,
        organization: ORGANIZACAO,
      })
    }
    if (revogado) return json({ error: 'invalid_grant', error_description: 'Token revoked' }, 400)
    // O Calendly rotaciona o refresh token a cada renovação — ao contrário do
    // Google, que costuma devolver a resposta sem ele.
    return json({
      access_token: 'cal.renovado',
      refresh_token: `${REFRESH}-2`,
      expires_in: 7200,
      owner: USUARIO,
      organization: ORGANIZACAO,
    })
  }

  if (url.startsWith('https://api.calendly.com/event_types')) {
    return json({
      collection: [
        { uri: TIPO_30, name: 'Conversa de 30 min', duration: 30, scheduling_url: 'https://calendly.com/ihte/30min', active: true },
        { uri: 'https://api.calendly.com/event_types/E60', name: 'Aula demonstrativa', duration: 60, scheduling_url: 'https://calendly.com/ihte/60min', active: true },
      ],
    })
  }

  if (url.startsWith('https://api.calendly.com/scheduling_links')) {
    linksPedidos += 1
    ultimoCorpoDoLink = JSON.parse(String(init?.body)) as Record<string, unknown>
    return json({ resource: { booking_url: LINK, owner: TIPO_30, owner_type: 'EventType' } })
  }

  // O Google só aparece aqui para o teste de preferência: os dois conectados.
  if (url.startsWith('https://oauth2.googleapis.com/token')) {
    return json({ access_token: 'ya29.google', refresh_token: '1//google', expires_in: 3600 })
  }

  return json({}, 404)
}) as typeof fetch

const d = db()
const [c] = await d.select().from(cliente).where(eq(cliente.slug, 'ihte')).limit(1)
if (!c) {
  console.error('sem o cliente ihte: rode o seed antes')
  process.exit(1)
}
// Destinos e conexões de agenda são do projeto; o registro de entrega continua
// sendo do cliente. O fixture precisa dos dois.
const [proj] = await d.select().from(projeto).where(eq(projeto.clienteId, c.id)).limit(1)
if (!proj) {
  console.error('o cliente ihte não tem projeto: rode o seed antes')
  process.exit(1)
}
const projetoId = proj.id
if (!c) {
  console.error('rode o seed antes')
  process.exit(1)
}

const problemas: string[] = []

// 1. Consentimento concluído, com o refresh token cifrado em repouso.
const conexao = await concluirConexaoCalendly(d, c.id, 'codigo-do-calendly')
console.log(`1. conexão: ${conexao.ok ? 'ok' : conexao.erro}`)
if (!conexao.ok) problemas.push('a conexão falhou')

const [linha] = await d
  .select()
  .from(integracao)
  .where(eq(integracao.projetoId, c.id))
  .then((rs) => rs.filter((r) => r.tipo === 'calendly'))

const segredo = linha?.segredo ?? ''
console.log(`   segredo: ${segredo.slice(0, 24)}…`)
if (segredo.includes(REFRESH)) problemas.push('o refresh token foi gravado em claro')
if (!segredo.startsWith('v1.')) problemas.push('o segredo não está no formato cifrado')
if (JSON.stringify(linha?.config ?? {}).includes(REFRESH)) {
  problemas.push('o refresh token vazou para a config')
}

// 2. Tipos de evento: é entre eles que o operador escolhe o que o fluxo oferece.
const tipos = await listarTiposDeEvento(d, c.id)
if ('erro' in tipos) {
  console.log(`2. tipos de evento: ${tipos.erro}`)
  problemas.push('não listou os tipos de evento')
} else {
  console.log(`2. tipos de evento: ${tipos.map((t) => `${t.nome} (${t.duracaoMin}min)`).join(', ')}`)
  if (tipos.length !== 2) problemas.push('esperava dois tipos de evento')
}

// 3. Sem tipo de evento escolhido, oferecer falha com uma mensagem que diz o que
//    fazer — e não com um erro de fornecedor.
const entrada = await ingerirLead(
  d,
  {
    clienteSlug: 'ihte',
    fluxoSlug: 'lead-novo',
    dados: { 'Full Name': 'Lead do Calendly', 'E-mail': EMAIL, Phone: '+61498765432' },
  },
  new Date('2026-03-10T22:00:00Z'),
)
if (!entrada.aceito) {
  console.error('lead recusado:', entrada.motivo)
  process.exit(1)
}

const pedido = {
  clienteId: c.id,
  projetoId,
  leadId: entrada.leadId,
  execucaoId: entrada.execucaoId,
  titulo: 'Conversa sobre o curso',
  duracaoMin: 30,
  emailDoLead: EMAIL,
  nomeDoLead: 'Lead do Calendly',
  fusoDoLead: 'Australia/Sydney',
  limites: LIMITES_PADRAO,
  de: new Date('2026-03-10T22:00:00Z'),
}

const semTipo = await oferecerReuniao(d, pedido)
console.log(`3. sem tipo de evento: ${semTipo.tipo === 'falhou' ? semTipo.erro : semTipo.tipo}`)
if (semTipo.tipo !== 'falhou') problemas.push('deveria falhar sem tipo de evento escolhido')
if (linksPedidos !== 0) problemas.push('pediu link sem tipo de evento escolhido')

// 4. Com o tipo escolhido, o adaptador devolve link — nunca marcação direta.
await definirDestino(d, c.id, 'calendly', { tipoDeEvento: TIPO_30 })
const oferta = await oferecerReuniao(d, pedido)
console.log(`4. oferta: ${oferta.tipo}${oferta.tipo === 'link' ? ` · ${oferta.url}` : ''}`)
if (oferta.tipo !== 'link' || oferta.url !== LINK) problemas.push('o Calendly deveria devolver link')
const corpoDoLink = (ultimoCorpoDoLink ?? {}) as { max_event_count?: number }
if (corpoDoLink.max_event_count !== 1) {
  problemas.push('o link de agendamento não é de uso único')
}

const [registro] = await reunioesDoLead(d, entrada.leadId)
console.log(`   registro: ${registro?.provedor} · ${registro?.status} · ${registro?.linkAgendamento}`)
if (registro?.status !== 'oferecida') problemas.push('a oferta deveria nascer como `oferecida`')
if (registro?.linkAgendamento !== LINK) problemas.push('o link não foi gravado no registro')

// 5. Assinatura do webhook. O corpo é o texto cru: reserializar o JSON muda
//    espaço e ordem de chave, e a assinatura deixa de bater.
const evento = {
  event: 'invitee.created',
  payload: {
    uri: 'https://api.calendly.com/scheduled_events/S1/invitees/I1',
    email: EMAIL,
    name: 'Lead do Calendly',
    status: 'active',
    scheduled_event: {
      uri: 'https://api.calendly.com/scheduled_events/S1',
      start_time: '2026-03-12T01:00:00.000Z',
      end_time: '2026-03-12T01:30:00.000Z',
    },
  },
}
const cru = JSON.stringify(evento)
const assinar = (corpo: string, t = Math.floor(Date.now() / 1000)) =>
  `t=${t},v1=${createHmac('sha256', CHAVE_WEBHOOK).update(`${t}.${corpo}`).digest('hex')}`

const boa = conferirAssinaturaCalendly(assinar(cru), cru, CHAVE_WEBHOOK)
const forjada = conferirAssinaturaCalendly('t=1,v1=deadbeef', cru, CHAVE_WEBHOOK)
const velha = conferirAssinaturaCalendly(
  assinar(cru, Math.floor(Date.now() / 1000) - 3600),
  cru,
  CHAVE_WEBHOOK,
)
const reserializado = conferirAssinaturaCalendly(
  assinar(cru),
  JSON.stringify(JSON.parse(cru), null, 2),
  CHAVE_WEBHOOK,
)
console.log(`5. assinatura: boa=${boa} forjada=${forjada} replay=${velha} reserializado=${reserializado}`)
if (!boa) problemas.push('assinatura legítima recusada')
if (forjada) problemas.push('assinatura forjada aceita')
if (velha) problemas.push('replay aceito')
if (reserializado) problemas.push('assinatura conferida sobre corpo reserializado')

// 6. O webhook confirma a oferta: é aqui que a reunião passa a existir.
const confirmacao = interpretarWebhookCalendly(JSON.parse(cru))
if (!confirmacao) {
  problemas.push('o webhook de criação não foi interpretado')
} else {
  const r = await confirmarReuniao(d, confirmacao)
  const [depois] = await reunioesDoLead(d, entrada.leadId)
  console.log(`6. confirmada: casou=${r.ok} · ${depois?.status} · ${depois?.inicio?.toISOString()}`)
  if (!r.ok) problemas.push('a confirmação não casou com a oferta')
  if (depois?.status !== 'marcada') problemas.push('a oferta não virou reunião marcada')
  if (depois?.externoId !== 'https://api.calendly.com/scheduled_events/S1') {
    problemas.push('o id externo não foi gravado')
  }
  if (depois?.inicio?.toISOString() !== '2026-03-12T01:00:00.000Z') {
    problemas.push('o horário escolhido pelo lead não foi gravado')
  }
}

// 7. Cancelamento casa pelo id externo, mesmo sem oferta em aberto.
const cancelamento = interpretarWebhookCalendly({
  event: 'invitee.canceled',
  payload: {
    email: EMAIL,
    status: 'canceled',
    cancellation: { reason: 'Surgiu um compromisso' },
    scheduled_event: {
      uri: 'https://api.calendly.com/scheduled_events/S1',
      start_time: '2026-03-12T01:00:00.000Z',
    },
  },
})
if (!cancelamento) {
  problemas.push('o webhook de cancelamento não foi interpretado')
} else {
  await confirmarReuniao(d, cancelamento)
  const [depois] = await reunioesDoLead(d, entrada.leadId)
  console.log(`7. cancelada: ${depois?.status} · ${depois?.motivoCancelamento}`)
  if (depois?.status !== 'cancelada') problemas.push('o cancelamento não foi registrado')
  if (depois?.motivoCancelamento !== 'Surgiu um compromisso') problemas.push('motivo não gravado')
}

// 8. Alguém marcou pelo link público do cliente, fora de um fluxo nosso: não é
//    erro, só não há lead a que amarrar.
const orfa = interpretarWebhookCalendly({
  event: 'invitee.created',
  payload: {
    email: 'desconhecido@exemplo.com',
    scheduled_event: { uri: 'https://api.calendly.com/scheduled_events/S9', start_time: '2026-03-13T01:00:00.000Z' },
  },
})
const semLead = orfa ? await confirmarReuniao(d, orfa) : { ok: true }
console.log(`8. reunião sem lead nosso: casou=${semLead.ok}`)
if (semLead.ok) problemas.push('casou uma reunião que não é de lead nenhum')

// 9. Preferência: com Google e Calendly conectados, quem decide é o cliente.
await concluirConexaoGoogle(d, c.id, 'google_calendar', 'codigo-do-google')
await definirDestino(d, c.id, 'google_calendar', { calendarios: ['ana@cliente.com'] })

const semPreferencia = await provedorDoProjeto(d, c.id)
await d.update(cliente).set({ provedorAgenda: 'google_calendar' }).where(eq(cliente.id, c.id))
const comGoogle = await provedorDoProjeto(d, c.id)
await d.update(cliente).set({ provedorAgenda: 'calendly' }).where(eq(cliente.id, c.id))
const comCalendly = await provedorDoProjeto(d, c.id)
console.log(`9. preferência: padrão=${semPreferencia} · google=${comGoogle} · calendly=${comCalendly}`)
if (semPreferencia !== 'calendly') problemas.push('sem preferência, o Calendly deveria ganhar')
if (comGoogle !== 'google_calendar') problemas.push('a preferência pelo Google foi ignorada')
if (comCalendly !== 'calendly') problemas.push('a preferência pelo Calendly foi ignorada')

// 10. Acesso revogado desliga a integração em vez de insistir a cada lead.
revogado = true
await definirDestino(d, c.id, 'calendly', { expiraEm: new Date(Date.now() - 60_000).toISOString() })
const depoisDeRevogar = await conexaoCalendly(d, c.id)
console.log(`10. revogado: ${'erro' in depoisDeRevogar ? depoisDeRevogar.erro : 'ainda conectado'}`)
if (!('erro' in depoisDeRevogar) || !depoisDeRevogar.precisaReconectar) {
  problemas.push('acesso revogado não pediu reconexão')
}
const [final] = await d
  .select()
  .from(integracao)
  .where(eq(integracao.projetoId, c.id))
  .then((rs) => rs.filter((x) => x.tipo === 'calendly'))
if (final?.ativo) problemas.push('a integração revogada continuou ativa')

// Com o Calendly desligado, a preferência por ele não pode mandar o motor para
// uma ferramenta que não responde.
const caiuParaGoogle = await provedorDoProjeto(d, c.id)
console.log(`    provedor após revogação: ${caiuParaGoogle}`)
if (caiuParaGoogle !== 'google_calendar') {
  problemas.push('com o Calendly revogado, deveria cair para a outra ferramenta conectada')
}

globalThis.fetch = original
console.log('')
if (problemas.length > 0) {
  console.log('❌ FALHOU:')
  for (const p of problemas) console.log(`   ${p}`)
} else {
  console.log('✅ link de uso único, oferta registrada, webhook assinado conferido sobre o corpo cru,')
  console.log('   confirmação e cancelamento do lead, preferência do cliente e revogação desligando')
}
await encerrarFila()
process.exit(problemas.length > 0 ? 1 : 0)
