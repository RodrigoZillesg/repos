/** Entrega do lead ponta a ponta: webhook de verdade e HubSpot falso.
 *
 *  O que se quer provar aqui é o que o produto antes não provava: que entrega
 *  que não acontece **deixa rastro**. Destino não configurado, endpoint do
 *  cliente fora do ar, token expirado — antes tudo isso terminava num `return`
 *  silencioso, e o primeiro a descobrir era o comercial dizendo que não chega
 *  lead nenhum.
 *
 *  O webhook é servido por um servidor HTTP local de verdade, não por um fetch
 *  falso: a assinatura precisa sobreviver a passar por um socket e ser conferida
 *  do outro lado, que é o que o cliente vai fazer. */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { desc, eq } from 'drizzle-orm'
import { cliente, db, integracao, lead as tLead, projeto, reuniao } from '@avexa/db'
import {
  concluirConexaoHubspot,
  definirWebhookDoProjeto,
  encerrarFila,
  entregasDoLead,
  enviarReuniaoAoCrm,
  ingerirLead,
  webhookDoProjeto,
} from '@avexa/servicos'
import { adaptadoresDoAmbiente, conferirAssinaturaSaida as conferir } from '@avexa/adapters'
import { entregarLead, dispararWebhookSaida } from '../src/entrega.ts'
import type { Ambiente } from '../src/contexto.ts'

process.env.APP_SECRET ??= 'chave-de-teste-com-mais-de-trinta-e-dois-caracteres'
process.env.HUBSPOT_CLIENT_ID ??= 'app-de-teste'
process.env.HUBSPOT_CLIENT_SECRET ??= 'segredo-de-teste'

const REFRESH = 'refresh-do-hubspot-secretissimo'
const problemas: string[] = []

/* ----------------------- o sistema do cliente, de verdade ---------------- */

interface Recebido {
  assinatura: string | undefined
  corpoCru: string
  entregaId: string | undefined
  tentativa: string | undefined
}

const recebidos: Recebido[] = []
/** Respostas que o "sistema do cliente" vai dar, em ordem. */
let respostas: number[] = [200]
let n = 0

const servidor = createServer((req: IncomingMessage, res: ServerResponse) => {
  let corpo = ''
  req.on('data', (p) => (corpo += p))
  req.on('end', () => {
    recebidos.push({
      assinatura: req.headers['x-avexa-assinatura'] as string | undefined,
      corpoCru: corpo,
      entregaId: req.headers['x-avexa-entrega'] as string | undefined,
      tentativa: req.headers['x-avexa-tentativa'] as string | undefined,
    })
    const status = respostas[Math.min(n++, respostas.length - 1)] ?? 200
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end('{}')
  })
})

await new Promise<void>((ok) => servidor.listen(0, '127.0.0.1', ok))
const porta = (servidor.address() as { port: number }).port
const URL_CLIENTE = `http://127.0.0.1:${porta}/avexa`

/* --------------------------- HubSpot de mentira -------------------------- */

let contatoPatch = 0
let reuniaoCriada = 0
let reuniaoPatch = 0
let reuniaoAssociada: string | undefined
let desfechoNoCrm = ''
const chamadasHubspot: string[] = []
const original = globalThis.fetch

globalThis.fetch = (async (entrada: string | URL | Request, init?: RequestInit) => {
  const url = String(entrada)
  // O servidor local é de verdade; só o HubSpot é de mentira.
  if (url.includes('127.0.0.1')) return original(entrada as string, init)

  chamadasHubspot.push(`${init?.method ?? 'POST'} ${url.split('?')[0]}`)
  const json = (corpo: unknown, status = 200) =>
    ({ ok: status < 300, status, text: async () => JSON.stringify(corpo) }) as Response

  if (url.includes('/oauth/v1/token')) {
    return json({ access_token: 'hs.acesso', refresh_token: REFRESH, expires_in: 1800 })
  }
  if (url.includes('/oauth/v1/access-tokens/')) {
    return json({ hub_id: 4242, hub_domain: 'escola.com.br', user: 'ops@escola.com.br', scopes: [] })
  }
  if (url.includes('/properties/contacts/hs_lead_status')) {
    return json({
      options: [
        { value: 'NEW', label: 'Novo' },
        { value: 'OPEN_DEAL', label: 'Negócio aberto' },
        { value: 'UNQUALIFIED', label: 'Desqualificado' },
      ],
    })
  }
  if (url.includes('/properties/contacts/groups')) return json({}, 409)
  if (url.match(/\/properties\/contacts\/avexa_/)) {
    return init?.method === 'GET' ? json({}, 404) : json({})
  }
  if (url.endsWith('/properties/contacts')) return json({ name: 'ok' })

  if (url.includes('/crm/v3/objects/contacts/') && url.includes('idProperty=email')) {
    contatoPatch += 1
    return json({ id: 'contato-1' })
  }
  if (url.includes('/crm/v3/objects/notes')) return json({ id: 'nota-1' })

  if (url.includes('/crm/v3/objects/meetings')) {
    const corpo = JSON.parse(String(init?.body ?? '{}')) as {
      properties?: Record<string, string>
    }
    if (init?.method === 'PATCH') {
      reuniaoPatch += 1
      desfechoNoCrm = corpo.properties?.hs_meeting_outcome ?? ''
      return json({ id: 'reuniao-1' })
    }
    reuniaoCriada += 1
    desfechoNoCrm = corpo.properties?.hs_meeting_outcome ?? ''
    reuniaoAssociada = (
      JSON.parse(String(init?.body ?? '{}')) as {
        associations?: Array<{ to?: { id?: string } }>
      }
    ).associations?.[0]?.to?.id
    return json({ id: 'reuniao-1' })
  }

  return json({}, 404)
}) as typeof fetch

/* -------------------------------- cenário -------------------------------- */

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

const amb: Ambiente = {
  db: d,
  adaptadores: adaptadoresDoAmbiente(),
  ia: null,
  agora: () => new Date('2026-03-10T23:00:00Z'),
}

const entrada = await ingerirLead(
  d,
  {
    clienteSlug: 'ihte',
    fluxoSlug: 'lead-novo',
    dados: {
      'Full Name': 'Marina Costa',
      'E-mail': 'marina.costa@exemplo.com',
      Phone: '+61411222333',
      curso: 'IELTS',
      utm_source: 'meta-ads',
    },
  },
  new Date('2026-03-10T23:00:00Z'),
)
if (!entrada.aceito) {
  console.error('lead recusado:', entrada.motivo)
  process.exit(1)
}

await d
  .update(tLead)
  .set({ score: 82, scoreMotivo: 'quer começar em abril', resumo: 'Procura IELTS noturno em Sydney.' })
  .where(eq(tLead.id, entrada.leadId))

const pedidoBase = {
  leadId: entrada.leadId,
  clienteId: c.id,
  projetoId,
  execucaoId: entrada.execucaoId,
  etapaId: 'saida-1',
  urgente: true,
}

const ultima = async (destino: string) =>
  (await entregasDoLead(d, entrada.leadId)).find((x) => x.destino === destino)

// 1. Destino que o cliente não configurou: antes era um `return` calado.
const semCrm = await entregarLead(amb, { ...pedidoBase, destino: 'CRM do cliente', seco: false })
const regSemCrm = await ultima('hubspot')
console.log(`1. sem CRM configurado: ${regSemCrm?.estado} · ${regSemCrm?.erro?.slice(0, 60)}`)
if (semCrm.ok) problemas.push('entregou num destino que não existe')
if (regSemCrm?.estado !== 'sem_destino') problemas.push('destino ausente não virou registro `sem_destino`')

// 2. Modo seco: o destino é resolvido, nada sai, e o registro diz isso.
await definirWebhookDoProjeto(d, c.id, URL_CLIENTE)
const seco = await entregarLead(amb, { ...pedidoBase, destino: 'Webhook do cliente', seco: true })
console.log(`2. modo seco: ok=${seco.ok} · chamadas ao cliente=${recebidos.length}`)
if (recebidos.length !== 0) problemas.push('o modo seco bateu no endpoint do cliente')
if ((await ultima('webhook'))?.estado !== 'seco') problemas.push('o modo seco não deixou registro')

// 3. Entrega de verdade, assinada, conferida do outro lado.
const r3 = await entregarLead(amb, { ...pedidoBase, destino: 'Webhook do cliente', seco: false })
const alvo = await d
  .select()
  .from(integracao)
  .where(eq(integracao.projetoId, c.id))
  .then((rs) => rs.find((x) => x.tipo === 'webhook'))
// O segredo pelo mesmo caminho que o worker usa: se ele não voltar decifrado,
// o problema aparece aqui e não em produção.
const segredo = (await webhookDoProjeto(d, c.id))?.segredo ?? ''
if (!segredo) problemas.push('o segredo do webhook não voltou decifrado')

const recebido = recebidos[0]
const confere = recebido ? conferir(recebido.assinatura, recebido.corpoCru, segredo) : false
const carga = recebido ? (JSON.parse(recebido.corpoCru) as { dados: Record<string, unknown> }) : null
console.log(`3. entregue: ok=${r3.ok} · assinatura confere=${confere}`)
console.log(`   carga: ${carga ? Object.keys(carga.dados).join(', ') : '—'}`)
if (!r3.ok) problemas.push('a entrega no webhook falhou')
if (!confere) problemas.push('o cliente não conseguiu conferir a assinatura')
if (carga?.dados.score !== 82) problemas.push('a carga foi sem o score')
if (recebido?.entregaId !== r3.externoId) problemas.push('o id de entrega não bate com o registro')
if (String(alvo?.segredo ?? '').includes('whsec_')) problemas.push('o segredo foi gravado em claro')

const reg3 = await ultima('webhook')
if (reg3?.estado !== 'entregue' || reg3.httpStatus !== 200) problemas.push('registro de entrega errado')

// 4. Endpoint do cliente instável: reenvia com o MESMO id de entrega.
recebidos.length = 0
n = 0
respostas = [500, 502, 200]
const r4 = await dispararWebhookSaida(amb, {
  leadId: entrada.leadId,
  clienteId: c.id,
  projetoId,
  execucaoId: entrada.execucaoId,
  etapaId: 'wh-1',
  url: URL_CLIENTE,
  metodo: 'POST',
  payload: 'Lead e score',
  cabecalhos: 'X-Cliente: escola\nX-Avexa-Assinatura: forjada',
  tentativas: 3,
  seco: false,
})
const ids = new Set(recebidos.map((x) => x.entregaId))
const reg4 = await ultima('webhook_saida')
console.log(`4. reenvio: ${recebidos.length} tentativas · ids distintos=${ids.size} · registro=${reg4?.tentativas}`)
if (!r4.ok) problemas.push('o reenvio não chegou a entregar')
if (recebidos.length !== 3) problemas.push(`esperava 3 tentativas, houve ${recebidos.length}`)
if (ids.size !== 1) problemas.push('cada tentativa foi com um id diferente — isso duplica lead')
if (reg4?.tentativas !== 3) problemas.push('o registro não guardou o número de tentativas')
const ultimoRecebido = recebidos.at(-1)
if (ultimoRecebido && !conferir(ultimoRecebido.assinatura, ultimoRecebido.corpoCru, segredo)) {
  problemas.push('a assinatura da última tentativa não confere')
}

// 5. Erro definitivo do cliente: uma tentativa só, e fica registrado.
recebidos.length = 0
n = 0
respostas = [400]
const r5 = await dispararWebhookSaida(amb, {
  leadId: entrada.leadId,
  clienteId: c.id,
  projetoId,
  url: URL_CLIENTE,
  metodo: 'POST',
  payload: 'Lead e score',
  cabecalhos: '',
  tentativas: 5,
  seco: false,
})
const reg5 = await ultima('webhook_saida')
console.log(`5. 400 do cliente: tentativas=${recebidos.length} · registro=${reg5?.estado} (${reg5?.httpStatus})`)
if (r5.ok) problemas.push('um 400 foi tratado como sucesso')
if (recebidos.length !== 1) problemas.push('insistiu num erro definitivo')
if (reg5?.estado !== 'falhou' || reg5.httpStatus !== 400) problemas.push('a falha não ficou registrada')

// 6. HubSpot: conexão prepara o portal antes da primeira entrega.
const conexao = await concluirConexaoHubspot(d, c.id, 'codigo-do-hubspot')
const linhaHs = await d
  .select()
  .from(integracao)
  .where(eq(integracao.projetoId, c.id))
  .then((rs) => rs.find((x) => x.tipo === 'hubspot'))
const cfgHs = (linhaHs?.config ?? {}) as Record<string, unknown>
console.log(`6. HubSpot conectado: portal ${cfgHs.conta} · status qualificado=${cfgHs.statusQualificado}`)
if (!conexao.ok) problemas.push(`a conexão com o HubSpot falhou: ${conexao.erro}`)
if (cfgHs.conta !== 'escola.com.br') problemas.push('não identificou o portal')
if (cfgHs.statusQualificado !== 'OPEN_DEAL') {
  problemas.push('escolheu um status que não é do portal')
}
if (String(linhaHs?.segredo ?? '').includes(REFRESH)) problemas.push('o refresh token foi gravado em claro')
if (!chamadasHubspot.some((x) => x.includes('/properties/contacts'))) {
  problemas.push('não criou as propriedades da Avexa na conexão')
}

// 7. Entrega no CRM: upsert, nota e a reunião que o lead já tinha marcado.
await d.insert(reuniao).values({
  leadId: entrada.leadId,
  clienteId: c.id,
  provedor: 'calendly',
  status: 'marcada',
  externoId: 'https://api.calendly.com/scheduled_events/S7',
  inicio: new Date('2026-03-12T01:00:00Z'),
  fim: new Date('2026-03-12T01:30:00Z'),
  linkEvento: 'https://calendly.com/eventos/S7',
})
// 7. Entrega no CRM: upsert e nota, nunca contato novo a cada lead.
const r7 = await entregarLead(amb, { ...pedidoBase, destino: 'CRM do cliente', seco: false })
const reg7 = await ultima('hubspot')
console.log(`7. CRM: ok=${r7.ok} · contato=${r7.externoId} · patches=${contatoPatch}`)
if (!r7.ok) problemas.push(`a entrega no HubSpot falhou: ${r7.erro}`)
if (r7.externoId !== 'contato-1') problemas.push('o id do contato não voltou')
if (contatoPatch !== 1) problemas.push('não usou upsert por e-mail')
if (!chamadasHubspot.some((x) => x.includes('/objects/notes'))) problemas.push('não criou a nota')
if (reg7?.estado !== 'entregue' || reg7.externoId !== 'contato-1') {
  problemas.push('a entrega no CRM não ficou registrada com o id do contato')
}

const regReuniao = await ultima('hubspot_reuniao')
const [linhaReuniao] = await d
  .select()
  .from(reuniao)
  .where(eq(reuniao.leadId, entrada.leadId))
  .orderBy(desc(reuniao.criadoEm))
  .limit(1)
console.log(
  `   reunião no CRM: criada=${reuniaoCriada} · desfecho=${desfechoNoCrm} · crmId=${linhaReuniao?.crmId}`,
)
if (reuniaoCriada !== 1) problemas.push('a reunião não subiu junto com a entrega')
if (reuniaoAssociada !== 'contato-1') problemas.push('a reunião não foi associada ao contato')
if (desfechoNoCrm !== 'SCHEDULED') problemas.push('a reunião não subiu como agendada')
if (linhaReuniao?.crmId !== 'reuniao-1') problemas.push('o id da reunião no CRM não foi guardado')
if (regReuniao?.estado !== 'entregue') problemas.push('a subida da reunião não ficou registrada')

// 7b. O lead cancela: a MESMA reunião é atualizada, nunca uma segunda criada.
await d
  .update(reuniao)
  .set({ status: 'cancelada', motivoCancelamento: 'Surgiu um imprevisto' })
  .where(eq(reuniao.id, linhaReuniao!.id))

const cancelamento = await enviarReuniaoAoCrm(d, entrada.leadId)
console.log(
  `7b. cancelamento: ok=${cancelamento.ok} · criadas=${reuniaoCriada} · patches=${reuniaoPatch} · desfecho=${desfechoNoCrm}`,
)
if (!cancelamento.ok) problemas.push('o cancelamento não subiu ao CRM')
if (reuniaoCriada !== 1) problemas.push('o cancelamento criou uma segunda reunião no CRM')
if (reuniaoPatch !== 1) problemas.push('o cancelamento não atualizou a reunião existente')
if (desfechoNoCrm !== 'CANCELED') problemas.push('a reunião não ficou como cancelada no CRM')

// 7c. Lead sem contato no CRM não tenta nada: é o caso comum, não é erro.
const outro = await ingerirLead(
  d,
  {
    clienteSlug: 'ihte',
    fluxoSlug: 'lead-novo',
    dados: { 'Full Name': 'Sem CRM', 'E-mail': 'sem.crm@exemplo.com', Phone: '+61433444555' },
  },
  new Date('2026-03-10T23:00:00Z'),
)
if (outro.aceito) {
  await d.insert(reuniao).values({
    leadId: outro.leadId,
    clienteId: c.id,
    provedor: 'calendly',
    status: 'marcada',
    inicio: new Date('2026-03-13T01:00:00Z'),
  })
  const antes = reuniaoCriada + reuniaoPatch
  const pulado = await enviarReuniaoAoCrm(d, outro.leadId)
  console.log(`7c. lead fora do CRM: ok=${pulado.ok} · pulado=${pulado.pulado}`)
  if (!pulado.ok || !pulado.pulado) problemas.push('tentou subir reunião de lead que não está no CRM')
  if (reuniaoCriada + reuniaoPatch !== antes) problemas.push('chamou o HubSpot sem contato')
  if ((await entregasDoLead(d, outro.leadId)).length !== 0) {
    problemas.push('registrou entrega para uma subida que nem aconteceu')
  }
}

// 8. Tudo que aconteceu com este lead está em um lugar só.
const todas = await entregasDoLead(d, entrada.leadId)
console.log(`8. histórico do lead: ${todas.map((x) => `${x.destino}:${x.estado}`).join(' · ')}`)
if (todas.length < 6) problemas.push('o histórico de entregas está incompleto')

globalThis.fetch = original
servidor.close()
console.log('')
if (problemas.length > 0) {
  console.log('❌ FALHOU:')
  for (const p of problemas) console.log(`   ${p}`)
} else {
  console.log('✅ assinatura conferida do outro lado, id estável entre reenvios, 400 sem insistência,')
  console.log('   HubSpot com upsert, nota e reunião que é atualizada ao cancelar em vez de duplicada,')
  console.log('   e toda entrega — inclusive a que não aconteceu — registrada')
}
await encerrarFila()
process.exit(problemas.length > 0 ? 1 : 0)
