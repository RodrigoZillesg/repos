import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import {
  criarNota,
  garantirPropriedades,
  salvarContato,
  salvarReuniaoHubspot,
  statusDeLead,
  trocarCodigoHubspot,
  urlDeConsentimentoHubspot,
} from './hubspot.ts'

interface Chamada {
  url: string
  metodo: string
  corpo: unknown
}

/** Fetch falso guiado por rota: o que importa neste adaptador é qual endpoint
 *  ele escolhe em cada caso, não a ordem das chamadas. */
function fetchFalso(rotas: Array<[RegExp, { status?: number; corpo?: unknown; metodo?: string }]>) {
  const chamadas: Chamada[] = []
  const buscar = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url)
    const metodo = init?.method ?? 'POST'
    let corpo: unknown = null
    try {
      corpo = init?.body ? JSON.parse(String(init.body)) : null
    } catch {
      corpo = String(init?.body)
    }
    chamadas.push({ url: u, metodo, corpo })

    const achada = rotas.find(([re, r]) => re.test(u) && (!r.metodo || r.metodo === metodo))
    const r = achada?.[1] ?? { status: 404 }
    const status = r.status ?? 200
    return { ok: status < 300, status, text: async () => JSON.stringify(r.corpo ?? {}) } as Response
  }) as typeof fetch
  return { buscar, chamadas }
}

const cfg = {
  clientId: 'id',
  clientSecret: 'segredo',
  redirectUri: 'https://app.avexa.global/api/integracoes/hubspot/retorno',
}

test('a URL de consentimento pede só os escopos que usamos', () => {
  const u = new URL(urlDeConsentimentoHubspot(cfg, 'estado'))
  assert.equal(u.origin + u.pathname, 'https://app.hubspot.com/oauth/authorize')
  assert.equal(u.searchParams.get('state'), 'estado')
  const escopos = (u.searchParams.get('scope') ?? '').split(' ')
  assert.ok(escopos.includes('crm.objects.contacts.write'))
  // Nada de escopo amplo de CRM: seria acesso à base comercial inteira.
  assert.ok(!escopos.some((e) => e === 'crm.objects.deals.write' || e === 'content'))
})

test('o token é trocado por formulário, como o HubSpot exige', async () => {
  const f = fetchFalso([
    [/oauth\/v1\/token/, { corpo: { access_token: 'at', refresh_token: 'rt', expires_in: 1800 } }],
  ])
  const r = await trocarCodigoHubspot({ ...cfg, buscar: f.buscar }, 'codigo')
  assert.ok(!('erro' in r))
  assert.equal(r.refreshToken, 'rt')
  // Corpo form-urlencoded chega como texto, não como JSON.
  assert.match(String(f.chamadas[0]!.corpo), /grant_type=authorization_code/)
  // Meia hora menos um minuto de folga.
  assert.ok(r.expiraEm.getTime() - Date.now() < 1800_000)
})

test('contato com e-mail é upsert, não criação', async () => {
  const f = fetchFalso([
    [/objects\/contacts\/[^/?]+\?idProperty=email/, { corpo: { id: '77' }, metodo: 'PATCH' }],
  ])
  const r = await salvarContato(
    'at',
    { email: 'ana@exemplo.com', nome: 'Ana', score: 82, resumo: 'quer IELTS' },
    f.buscar,
  )
  assert.deepEqual(r, { ok: true, id: '77', criado: false })
  assert.equal(f.chamadas.length, 1)
  assert.equal(f.chamadas[0]!.metodo, 'PATCH')
  const props = (f.chamadas[0]!.corpo as { properties: Record<string, string> }).properties
  assert.equal(props.avexa_score, '82')
  assert.equal(props.firstname, 'Ana')
})

test('contato novo: o upsert dá 404 e aí sim cria', async () => {
  const f = fetchFalso([
    [/objects\/contacts\/[^/?]+\?idProperty=email/, { status: 404, metodo: 'PATCH' }],
    [/objects\/contacts$/, { corpo: { id: '90' }, metodo: 'POST' }],
  ])
  const r = await salvarContato('at', { email: 'novo@exemplo.com' }, f.buscar)
  assert.deepEqual(r, { ok: true, id: '90', criado: true })
})

test('409 na criação vira atualização: o contato existe, duplicar seria pior', async () => {
  let patches = 0
  const f = fetchFalso([
    [
      /objects\/contacts\/[^/?]+\?idProperty=email/,
      { metodo: 'PATCH', get status() { return patches++ === 0 ? 404 : 200 }, corpo: { id: '55' } },
    ],
    [/objects\/contacts$/, { status: 409, metodo: 'POST' }],
  ])
  const r = await salvarContato('at', { email: 'corrida@exemplo.com' }, f.buscar)
  assert.deepEqual(r, { ok: true, id: '55', criado: false })
})

test('sem e-mail, acha pelo telefone antes de criar outro contato', async () => {
  const f = fetchFalso([
    [/objects\/contacts\/search/, { corpo: { results: [{ id: '31' }] } }],
    [/objects\/contacts\/31/, { corpo: { id: '31' }, metodo: 'PATCH' }],
  ])
  const r = await salvarContato('at', { telefone: '+61400000000', nome: 'Sem e-mail' }, f.buscar)
  assert.deepEqual(r, { ok: true, id: '31', criado: false })
  assert.ok(f.chamadas.some((c) => c.url.includes('/search')))
})

test('lead sem nada para gravar não vira chamada nenhuma', async () => {
  const f = fetchFalso([])
  const r = await salvarContato('at', {}, f.buscar)
  assert.equal(r.ok, false)
  assert.equal(f.chamadas.length, 0)
})

test('erro passageiro é marcado como reenviável; 400 não', async () => {
  const cair = (status: number) =>
    fetchFalso([[/objects\/contacts\/[^/?]+\?idProperty=email/, { status, metodo: 'PATCH' }]])

  const t429 = await salvarContato('at', { email: 'a@b.com' }, cair(429).buscar)
  assert.equal(t429.ok === false && t429.reenviavel, true)

  const t400 = await salvarContato('at', { email: 'a@b.com' }, cair(400).buscar)
  assert.equal(t400.ok === false && t400.reenviavel, false)
})

test('nota sem permissão é degradação, não falha de entrega', async () => {
  const f = fetchFalso([[/objects\/notes/, { status: 403 }]])
  const r = await criarNota('at', '77', 'resumo', new Date(), f.buscar)
  assert.equal(r.ok, false)
  assert.equal(r.ok === false && r.semPermissao, true)
})

test('a nota é associada ao contato pelo tipo 202', async () => {
  const f = fetchFalso([[/objects\/notes/, { corpo: { id: 'n1' } }]])
  await criarNota('at', '77', 'resumo', new Date('2026-03-10T00:00:00Z'), f.buscar)
  const corpo = f.chamadas[0]!.corpo as {
    associations: Array<{ to: { id: string }; types: Array<{ associationTypeId: number }> }>
  }
  assert.equal(corpo.associations[0]!.to.id, '77')
  assert.equal(corpo.associations[0]!.types[0]!.associationTypeId, 202)
})

test('propriedade que já existe não é recriada', async () => {
  const f = fetchFalso([
    [/properties\/contacts\/groups/, { status: 409 }],
    [/properties\/contacts\/avexa_score/, { corpo: { name: 'avexa_score' }, metodo: 'GET' }],
    [/properties\/contacts\/avexa_/, { status: 404, metodo: 'GET' }],
    [/properties\/contacts$/, { corpo: {}, metodo: 'POST' }],
  ])
  const r = await garantirPropriedades('at', f.buscar)
  assert.ok(!('erro' in r))
  assert.equal(r.criadas.includes('avexa_score'), false)
  assert.equal(r.criadas.includes('avexa_resumo'), true)
})

test('os status de lead vêm do portal, e os escondidos ficam de fora', async () => {
  const f = fetchFalso([
    [
      /properties\/contacts\/hs_lead_status/,
      {
        metodo: 'GET',
        corpo: {
          options: [
            { value: 'NEW', label: 'Novo' },
            { value: 'LEGADO', label: 'Antigo', hidden: true },
            { value: 'OPEN_DEAL', label: 'Negócio aberto' },
          ],
        },
      },
    ],
  ])
  const r = await statusDeLead('at', f.buscar)
  assert.deepEqual(r, [
    { valor: 'NEW', rotulo: 'Novo' },
    { valor: 'OPEN_DEAL', rotulo: 'Negócio aberto' },
  ])
})

test('reunião nova é criada e associada ao contato pelo tipo 200', async () => {
  const f = fetchFalso([[/objects\/meetings$/, { corpo: { id: 'm1' }, metodo: 'POST' }]])
  const r = await salvarReuniaoHubspot(
    'at',
    '77',
    {
      titulo: 'Conversa com Ana',
      inicio: new Date('2026-03-12T01:00:00Z'),
      fim: new Date('2026-03-12T01:30:00Z'),
      desfecho: 'SCHEDULED',
    },
    undefined,
    f.buscar,
  )
  assert.deepEqual(r, { ok: true, id: 'm1', criada: true })
  const corpo = f.chamadas[0]!.corpo as {
    properties: Record<string, string>
    associations: Array<{ to: { id: string }; types: Array<{ associationTypeId: number }> }>
  }
  assert.equal(corpo.associations[0]!.types[0]!.associationTypeId, 200)
  assert.equal(corpo.properties.hs_meeting_outcome, 'SCHEDULED')
  assert.equal(corpo.properties.hs_timestamp, '2026-03-12T01:00:00.000Z')
})

test('reunião que já existe é atualizada, nunca criada de novo', async () => {
  const f = fetchFalso([[/objects\/meetings\/m1/, { corpo: { id: 'm1' }, metodo: 'PATCH' }]])
  const r = await salvarReuniaoHubspot(
    'at',
    '77',
    { titulo: 'Reunião cancelada', inicio: new Date('2026-03-12T01:00:00Z'), desfecho: 'CANCELED' },
    'm1',
    f.buscar,
  )
  assert.deepEqual(r, { ok: true, id: 'm1', criada: false })
  assert.equal(f.chamadas.length, 1)
  assert.equal(f.chamadas[0]!.metodo, 'PATCH')
  const props = (f.chamadas[0]!.corpo as { properties: Record<string, string> }).properties
  assert.equal(props.hs_meeting_outcome, 'CANCELED')
})

test('reunião apagada no portal é recriada em vez de sumir', async () => {
  const f = fetchFalso([
    [/objects\/meetings\/m1/, { status: 404, metodo: 'PATCH' }],
    [/objects\/meetings$/, { corpo: { id: 'm2' }, metodo: 'POST' }],
  ])
  const r = await salvarReuniaoHubspot(
    'at',
    '77',
    { titulo: 'Conversa', inicio: new Date('2026-03-12T01:00:00Z'), desfecho: 'SCHEDULED' },
    'm1',
    f.buscar,
  )
  assert.deepEqual(r, { ok: true, id: 'm2', criada: true })
})

test('sem fim, a reunião dura meia hora em vez de não ter fim nenhum', async () => {
  const f = fetchFalso([[/objects\/meetings$/, { corpo: { id: 'm1' }, metodo: 'POST' }]])
  await salvarReuniaoHubspot(
    'at',
    '77',
    { titulo: 'Conversa', inicio: new Date('2026-03-12T01:00:00Z'), desfecho: 'SCHEDULED' },
    undefined,
    f.buscar,
  )
  const props = (f.chamadas[0]!.corpo as { properties: Record<string, string> }).properties
  assert.equal(props.hs_meeting_end_time, '2026-03-12T01:30:00.000Z')
})

test('403 na reunião é falta de escopo, e não é reenviável', async () => {
  const f = fetchFalso([[/objects\/meetings$/, { status: 403, metodo: 'POST' }]])
  const r = await salvarReuniaoHubspot(
    'at',
    '77',
    { titulo: 'Conversa', inicio: new Date('2026-03-12T01:00:00Z'), desfecho: 'SCHEDULED' },
    undefined,
    f.buscar,
  )
  assert.equal(r.ok, false)
  assert.equal(r.ok === false && r.semPermissao, true)
  assert.equal(r.ok === false && r.reenviavel, false)
})
