/** Dados de partida: os três clientes e a equipe do artefato.
 *
 *  Passa pela mesma `ativarCliente` que o painel usa. Se o seed tivesse a sua
 *  própria lógica, o cliente de desenvolvimento não se pareceria com o cliente
 *  de verdade, e a diferença só apareceria em produção. */
import { cliente, db, configGlobal, numero, usuario } from '@avexa/db'
import { ativarCliente, type EntradaAtivacao } from './provisionamento.ts'

const CLIENTES: EntradaAtivacao[] = [
  {
    nome: 'International House',
    slug: 'ihte',
    produto: 'cursos de inglês em Sydney',
    setor: 'Escola de idiomas',
    fusoHorario: 'Australia/Sydney',
    canais: { ligacao: true, whatsapp: true, sms: true, email: true, telegram: false },
    emailDoTime: 'comercial@ihte.exemplo.com',
    fluxosExtras: ['Recuperação por telefone', 'Confirmação de reunião'],
  },
  {
    nome: 'LanguageBird',
    slug: 'lbird',
    produto: 'aulas particulares de idiomas',
    setor: 'Aulas particulares',
    fusoHorario: 'America/Los_Angeles',
    canais: { ligacao: true, whatsapp: false, sms: true, email: true, telegram: false },
    emailDoTime: 'comercial@lbird.exemplo.com',
  },
  {
    nome: 'English Australia',
    slug: 'eaus',
    produto: 'associação de escolas de inglês',
    setor: 'Associação de escolas',
    fusoHorario: 'Australia/Sydney',
    canais: { ligacao: false, whatsapp: false, sms: false, email: true, telegram: false },
    emailDoTime: 'comercial@eaus.exemplo.com',
  },
]

// Só quem precisa entrar hoje. Conta viva sem dono é porta aberta, e o
// padrão da casa é nome.sobrenome@platty.tech — acrescente pelo mesmo
// formato quando houver mais gente.
const EQUIPE = [{ nome: 'Rodrigo', email: 'rodrigo.zillesg@platty.tech', papel: 'admin' }] as const

async function semear(): Promise<void> {
  const d = db()

  await d.insert(configGlobal).values({ id: 1 }).onConflictDoNothing()

  for (const u of EQUIPE) {
    await d.insert(usuario).values({ ...u }).onConflictDoNothing()
  }

  // O pool precisa existir antes da ativação: é dele que sai o número de voz.
  for (const e164 of ['+61255500101', '+61255500102', '+14155550101', '+14155550102']) {
    await d.insert(numero).values({ e164 }).onConflictDoNothing()
  }

  const existentes = await d.select({ slug: cliente.slug }).from(cliente)
  const jaTem = new Set(existentes.map((c) => c.slug))

  for (const c of CLIENTES) {
    if (jaTem.has(c.slug)) {
      console.log(`[seed] ${c.nome}: já existe, pulando`)
      continue
    }
    const r = await ativarCliente(d, c)
    if (!r.ok) {
      console.error(`[seed] ${c.nome} falhou: ${r.erro}`)
      continue
    }
    for (const u of r.urls) console.log(`[seed] ${c.nome} · ${u.fluxo} → ${u.url}`)
  }

  console.log('[seed] pronto')
  process.exit(0)
}

semear().catch((e) => {
  console.error('[seed] falhou:', e)
  process.exit(1)
})
