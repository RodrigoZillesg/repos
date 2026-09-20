import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  criarAssistente,
  importarNumeroNaVapi,
  DESFECHOS_LIGACAO,
  type AssistenteVapi,
} from './vapi.ts'

const CRED = { apiKey: 'chave' }

function falso(resposta: unknown, status = 200) {
  const chamadas: Array<{ url: string; metodo: string; corpo: Record<string, unknown> }> = []
  const buscar = (async (url: string, init: RequestInit = {}) => {
    chamadas.push({
      url: String(url),
      metodo: init.method ?? 'GET',
      corpo: init.body ? JSON.parse(String(init.body)) : {},
    })
    return new Response(JSON.stringify(resposta), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  }) as unknown as typeof fetch
  return { buscar, chamadas }
}

const BASE: AssistenteVapi = {
  nome: 'Avexa · Lingua Bird',
  modeloProvedor: 'openai',
  modelo: 'gpt-5.6-terra',
  prompt: 'você trabalha para a Lingua Bird',
  primeiraMensagem: 'Hi, is this {{leadName}}?',
  mensagemEncerramento: 'Have a great day!',
  mensagemCaixaPostal: 'Please call back.',
  provedorVoz: '11labs',
  vozId: 'sarah',
  modeloVoz: 'eleven_multilingual_v2',
  transcritor: 'deepgram',
  modeloTranscritor: 'nova-3',
  idioma: 'en',
  webhook: 'https://new.avexa.global/api/webhooks/ligacao',
}

test('o webhook aponta para o Avexa, não para terceiros', async () => {
  // O agente que serviu de base postava para um sistema de terceiros. Sem
  // isto, o opt-out dito em voz alta nunca chega à nossa supressão global.
  const f = falso({ id: 'asst_1' })
  await criarAssistente({ ...CRED, buscar: f.buscar }, BASE)

  const c = f.chamadas[0]!.corpo as { server?: { url?: string } }
  assert.equal(c.server?.url, 'https://new.avexa.global/api/webhooks/ligacao')
})

test('o desfecho sai estruturado, não solto na transcrição', async () => {
  const f = falso({ id: 'asst_1' })
  await criarAssistente({ ...CRED, buscar: f.buscar }, BASE)

  const c = f.chamadas[0]!.corpo as {
    analysisPlan?: { structuredDataPlan?: { enabled?: boolean; schema?: Record<string, unknown> } }
  }
  assert.equal(c.analysisPlan?.structuredDataPlan?.enabled, true)

  const props = c.analysisPlan!.structuredDataPlan!.schema!.properties as {
    desfecho: { enum: string[] }
  }
  assert.deepEqual(props.desfecho.enum, [...DESFECHOS_LIGACAO])
  // O opt-out precisa ser um desfecho de primeira classe: é dele que sai a
  // entrada na supressão global.
  assert.ok(props.desfecho.enum.includes('optout'))
})

test('caixa postal e desligamento são nativos, sem ferramenta externa', async () => {
  const f = falso({ id: 'asst_1' })
  await criarAssistente({ ...CRED, buscar: f.buscar }, BASE)

  const c = f.chamadas[0]!.corpo as Record<string, unknown>
  assert.deepEqual(c.voicemailDetection, { provider: 'vapi' })
  assert.equal(c.endCallFunctionEnabled, true)
  assert.equal(c.dialKeypadFunctionEnabled, true)
  // Nenhuma tool herdada: cada uma seria uma dependência a mais para falhar
  // no meio de uma ligação.
  assert.equal(c.toolIds, undefined)
})

test('o idioma vai para o transcritor, em vez de duplicar agente', async () => {
  const f = falso({ id: 'asst_1' })
  await criarAssistente({ ...CRED, buscar: f.buscar }, { ...BASE, idioma: 'pt' })

  const c = f.chamadas[0]!.corpo as { transcriber?: { language?: string } }
  assert.equal(c.transcriber?.language, 'pt')
})

test('criação sem id de volta é falha, não sucesso silencioso', async () => {
  const f = falso({ name: 'sem id' })
  const r = await criarAssistente({ ...CRED, buscar: f.buscar }, BASE)
  assert.equal(r.ok, false)
})

test('a importação do número leva as credenciais do Twilio e já vincula', async () => {
  const f = falso({ id: 'pn_1' })
  const r = await importarNumeroNaVapi(
    { ...CRED, buscar: f.buscar },
    {
      e164: '+61255500101',
      twilioAccountSid: 'ACxxx',
      twilioAuthToken: 'tok',
      assistantId: 'asst_1',
      apelido: 'Avexa · Lingua Bird',
    },
  )

  assert.ok(r.ok)
  assert.equal(r.id, 'pn_1')

  const c = f.chamadas[0]!.corpo as Record<string, unknown>
  assert.equal(c.provider, 'twilio')
  assert.equal(c.number, '+61255500101')
  // Número sem assistente não atende ninguém.
  assert.equal(c.assistantId, 'asst_1')
})
