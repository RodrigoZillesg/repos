import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { paisDoFuso } from '@avexa/core'
import { db } from './index.ts'
import {
  cliente,
  clienteCanal,
  configGlobal,
  fluxo,
  fluxoVersao,
  integracao,
  numero,
  template,
  usuario,
} from './schema/index.ts'

/** Dados de partida: os três clientes e a equipe do artefato.
 *
 *  Serve para desenvolvimento e para o lead de teste da ativação. Tudo nasce em
 *  modo seco: o fluxo roda inteiro, cada tentativa é gravada e nada sai. */

const CLIENTES = [
  {
    slug: 'ihte',
    nome: 'International House',
    setor: 'Escola de idiomas',
    fuso: 'Australia/Sydney',
    canais: { ligacao: true, whatsapp: true, sms: true, email: true },
  },
  {
    slug: 'lbird',
    nome: 'LanguageBird',
    setor: 'Aulas particulares',
    fuso: 'America/Los_Angeles',
    canais: { ligacao: true, whatsapp: false, sms: true, email: true },
  },
  {
    slug: 'eaus',
    nome: 'English Australia',
    setor: 'Associação de escolas',
    fuso: 'Australia/Sydney',
    canais: { ligacao: false, whatsapp: false, sms: false, email: true },
  },
] as const

const EQUIPE = [
  { nome: 'Rodrigo', email: 'rodrigo@platty.tech', papel: 'admin' },
  { nome: 'Enzo', email: 'enzo@platty.tech', papel: 'operacao' },
  { nome: 'Paulo', email: 'paulo@platty.tech', papel: 'designer' },
  { nome: 'Sebastian', email: 'sebastian@platty.tech', papel: 'copy' },
] as const

const etapa = (tipo: string, cfg: Record<string, string>, extra: Record<string, unknown> = {}) => ({
  id: randomUUID().slice(0, 8),
  tipo,
  cfg,
  ...extra,
})

function fluxoLeadNovo(slug: string) {
  return [
    etapa('entrada', {
      url: `https://hooks.avexa.global/v1/${slug}/lead-novo`,
      metodo: 'POST (JSON)',
      campos: 'nome, telefone, email, curso',
      utm: 'Sim, todas as utm_*',
      extra: 'origem_campanha, unidade, turno',
      idade: '24 horas',
      dedupe: 'Atualizar e não recontatar',
    }),
    etapa('guarda', { janela: '09:00 às 20:00', fds: 'Não' }),
    etapa('ligacao', {
      roteiro: 'Qualificação inicial',
      ring: '30 segundos',
      vm: 'Deixar recado',
      obs: '',
    }),
    etapa('espera', { dur: '2 horas', cancel: 'Sim' }),
    etapa('whatsapp', {
      modo: 'Template aprovado',
      template: 'Primeiro contato',
      conversa: 'Sim',
    }),
    etapa('espera', { dur: '24 horas', cancel: 'Sim' }),
    etapa('email', { template: 'Retomada', replyto: 'Time do cliente' }),
    etapa('score', { criterio: 'Quer começar nos próximos 3 meses', corte: '60' }),
    etapa(
      'condicao',
      { campo: 'Score do lead', op: 'é maior que', valor: '60' },
      {
        sim: [etapa('entregar', { destino: 'E-mail do time', urgente: 'Sim' })],
        nao: [etapa('encerrar', { motivo: 'Não respondeu' })],
      },
    ),
  ]
}

const TEMPLATES = [
  {
    canal: 'whatsapp' as const,
    nome: 'Primeiro contato',
    corpo: 'Oi {{nome}}! Aqui é da {{cliente}}. Vi seu interesse em {{curso}} — posso te mandar as turmas?',
    variaveis: { curso: 'inglês geral' },
    status: 'aprovado' as const,
    metaTemplateId: 'primeiro_contato',
  },
  {
    canal: 'sms' as const,
    nome: 'Lembrete',
    corpo: '{{cliente}}: ainda dá tempo de garantir sua vaga. Responda PARAR para não receber mais.',
    variaveis: {},
    status: 'aprovado' as const,
  },
  {
    canal: 'email' as const,
    nome: 'Retomada',
    assunto: '{{nome}}, ainda quer começar?',
    corpo: 'Oi {{nome}},\n\nTentamos falar com você sobre {{curso}}. Responda este e-mail e a gente segue daqui.\n\n{{cliente}}',
    variaveis: { curso: 'inglês geral' },
    status: 'aprovado' as const,
  },
]

async function semear(): Promise<void> {
  const d = db()

  await d.insert(configGlobal).values({ id: 1 }).onConflictDoNothing()

  for (const u of EQUIPE) {
    await d.insert(usuario).values({ ...u }).onConflictDoNothing()
  }

  // Pool de voz: o mesmo número atende SMS, para o lead reconhecer a origem.
  for (const e164 of ['+61255500101', '+61255500102', '+14155550101']) {
    await d.insert(numero).values({ e164 }).onConflictDoNothing()
  }

  for (const c of CLIENTES) {
    const [cli] = await d
      .insert(cliente)
      .values({
        slug: c.slug,
        nome: c.nome,
        setor: c.setor,
        fusoHorario: c.fuso,
        pais: paisDoFuso(c.fuso),
        status: 'ativo',
      })
      .onConflictDoNothing()
      .returning({ id: cliente.id })
    if (!cli) continue

    for (const [canal, ativo] of Object.entries(c.canais)) {
      await d
        .insert(clienteCanal)
        .values({ clienteId: cli.id, canal: canal as 'email', ativo })
        .onConflictDoNothing()
    }

    for (const t of TEMPLATES) {
      await d.insert(template).values({ clienteId: cli.id, ...t })
    }

    await d.insert(integracao).values({
      clienteId: cli.id,
      tipo: 'email_time',
      nome: 'Time comercial',
      config: { para: `comercial@${c.slug}.exemplo.com` },
    })

    const [flu] = await d
      .insert(fluxo)
      .values({ clienteId: cli.id, nome: 'Lead novo do site', slug: 'lead-novo', status: 'publicado' })
      .returning({ id: fluxo.id })

    const [ver] = await d
      .insert(fluxoVersao)
      .values({ fluxoId: flu!.id, versao: 1, grafo: fluxoLeadNovo(c.slug), publicadaEm: new Date() })
      .returning({ id: fluxoVersao.id })

    await d.update(fluxo).set({ versaoPublicadaId: ver!.id }).where(eq(fluxo.id, flu!.id))
    console.log(`[seed] ${c.nome}: fluxo publicado em hooks.avexa.global/v1/${c.slug}/lead-novo`)
  }

  console.log('[seed] pronto')
  process.exit(0)
}

semear().catch((e) => {
  console.error('[seed] falhou:', e)
  process.exit(1)
})
