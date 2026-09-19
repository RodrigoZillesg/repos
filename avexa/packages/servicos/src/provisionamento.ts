import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import {
  cliente,
  clienteCanal,
  fluxo,
  fluxoVersao,
  integracao,
  numero,
  template,
  type Db,
} from '@avexa/db'
import {
  paisDoFuso,
  paisDoTelefone,
  renderizar,
  type Canal,
  type Etapa,
  type Grafo,
  type Pais,
} from '@avexa/core'
import type { CredenciaisTwilio } from '@avexa/adapters'
import { MODELOS_AVEXA, ROTEIROS_AVEXA } from './modelos.ts'
import { definirRemetente, provisionarNumero } from './numeros.ts'

/** Ativação de um cliente: os nove passos do painel, em código.
 *
 *  Oito são nossos; o oitavo da lista é do cliente (colar a URL e publicar o
 *  opt-in) e por isso não aparece aqui. A função é idempotente pelo slug: rodar
 *  de novo para um slug que já existe falha em vez de duplicar, porque metade de
 *  uma ativação é pior que nenhuma. */

/** De onde sai o número de telefone deste cliente.
 *
 *  Ligação e SMS usam o número próprio do cliente; WhatsApp e e-mail saem
 *  sempre da Avexa. Por isso a escolha existe uma vez só, e vale para os dois
 *  canais de telefonia: o lead tem que ver o mesmo número ligando e mandando
 *  mensagem. */
export type EscolhaDeNumero =
  /** Pega um número livre do pool. Instantâneo, e não gasta nada novo. */
  | { modo: 'pool' }
  /** Um número específico que já é nosso, escolhido à mão. */
  | { modo: 'existente'; e164: string }
  /** Compra um número novo no Twilio. Passa a custar todo mês. */
  | { modo: 'comprar'; pais?: string }

export interface OpcoesAtivacao {
  /** Padrão: pool. Comprar exige credenciais do Twilio. */
  numero?: EscolhaDeNumero
  twilio?: CredenciaisTwilio
  /** Para onde o Twilio manda resposta e opt-out do número comprado. */
  webhookSms?: string | null
}

export interface EntradaAtivacao {
  nome: string
  slug: string
  /** O que o cliente vende. Entra nos templates e no roteiro de voz. */
  produto: string
  setor?: string
  fusoHorario: string
  pais?: Pais
  canais: Record<Canal, boolean>
  /** Onde os leads qualificados chegam. */
  emailDoTime?: string
  /** Fluxos a criar, além do padrão. */
  fluxosExtras?: string[]
}

export type EstadoPasso = 'feito' | 'pulado' | 'falhou'

export interface Passo {
  n: number
  nome: string
  estado: EstadoPasso
  detalhe: string
}

export interface ResultadoAtivacao {
  ok: boolean
  clienteId?: string
  passos: Passo[]
  /** URLs de entrada, uma por fluxo, prontas para entregar ao cliente. */
  urls: Array<{ fluxo: string; url: string }>
  /** O que ficou pendente e o operador precisa saber antes do primeiro lead.
   *  Não impede a ativação, mas descobrir isso pelo primeiro lead é pior. */
  avisos: string[]
  erro?: string
}

const BASE_HOOK = process.env.HOOKS_BASE_URL ?? 'https://hooks.avexa.global/v1'

const avisoDePais = (e164: string, pais: string) =>
  `O número ${e164} não é de ${pais}. Ligar e mandar SMS de outro país derruba a taxa de resposta — troque antes de virar a chave.`

const eid = () => randomUUID().slice(0, 8)
const etapa = (tipo: string, cfg: Record<string, string>, extra: Record<string, unknown> = {}) =>
  ({ id: eid(), tipo, cfg, ...extra }) as unknown as Etapa

export function urlDeEntrada(clienteSlug: string, fluxoSlug: string): string {
  return `${BASE_HOOK}/${clienteSlug}/${fluxoSlug}`
}

export function paraSlug(texto: string): string {
  return (
    texto
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'cliente'
  )
}

/** Monta o fluxo padrão com os canais que o cliente contratou.
 *
 *  As esperas só entram entre dois contatos: um fluxo de e-mail único não deve
 *  nascer com uma espera pendurada antes do nada. */
export function fluxoPadrao(clienteSlug: string, canais: Record<string, boolean>): Grafo {
  const contatos: Etapa[] = []
  const push = (e: Etapa) => {
    if (contatos.length > 0) {
      contatos.push(
        etapa('espera', { dur: contatos.length === 1 ? '2 horas' : '24 horas', cancel: 'Sim' }),
      )
    }
    contatos.push(e)
  }

  if (canais.ligacao) {
    push(
      etapa('ligacao', {
        roteiro: 'Qualificação inicial',
        ring: '30 segundos',
        vm: 'Deixar recado',
        obs: '',
      }),
    )
  }
  if (canais.whatsapp) {
    push(etapa('whatsapp', { modo: 'Template aprovado', template: 'Primeiro contato', conversa: 'Sim' }))
  }
  if (canais.email) {
    push(etapa('email', { template: 'Retomada', replyto: 'Time do cliente' }))
  }
  // SMS só entra quando não há WhatsApp: os dois fazem o mesmo trabalho, e mandar
  // os dois para a mesma pessoa gasta duas tentativas do teto por nada.
  if (canais.sms && !canais.whatsapp) {
    push(etapa('sms', { template: 'Lembrete', link: 'Sim' }))
  }

  return [
    etapa('entrada', {
      url: urlDeEntrada(clienteSlug, 'lead-novo'),
      metodo: 'POST (JSON)',
      campos: 'nome, telefone, email',
      utm: 'Sim, todas as utm_*',
      extra: '',
      idade: '24 horas',
      dedupe: 'Atualizar e não recontatar',
    }),
    etapa('guarda', { janela: '09:00 às 20:00', fds: 'Não' }),
    ...contatos,
    etapa('score', { criterio: `Encaixe com ${'{{produto}}'}`, corte: '60' }),
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

export async function ativarCliente(
  db: Db,
  entrada: EntradaAtivacao,
  opcoes: OpcoesAtivacao = {},
): Promise<ResultadoAtivacao> {
  const passos: Passo[] = []
  const urls: ResultadoAtivacao['urls'] = []
  const avisos: string[] = []
  const marcar = (n: number, nome: string, estado: EstadoPasso, detalhe: string) =>
    passos.push({ n, nome, estado, detalhe })

  const slug = paraSlug(entrada.slug || entrada.nome)
  const paisCliente = entrada.pais ?? paisDoFuso(entrada.fusoHorario)

  const [jaExiste] = await db.select({ id: cliente.id }).from(cliente).where(eq(cliente.slug, slug)).limit(1)
  if (jaExiste) {
    return {
      ok: false,
      passos,
      urls: [],
      avisos,
      erro: `Já existe um cliente com o endereço "${slug}".`,
    }
  }

  // 1. Cadastrar o cliente.
  const [novo] = await db
    .insert(cliente)
    .values({
      slug,
      nome: entrada.nome,
      setor: entrada.setor ?? null,
      fusoHorario: entrada.fusoHorario,
      pais: paisCliente,
      status: 'ativando',
      // Nasce em modo seco: o primeiro lead real só sai depois que alguém olhar
      // o lead de teste e virar a chave de propósito.
      dryRun: true,
    })
    .returning({ id: cliente.id })

  const clienteId = novo!.id
  marcar(1, 'Cadastrar o cliente', 'feito', `${entrada.nome} · ${entrada.fusoHorario} · modo seco`)

  // 2. Canais contratados (as URLs vêm no passo 3, junto com os fluxos).
  const canais = Object.entries(entrada.canais).filter(([, v]) => v).map(([k]) => k as Canal)
  for (const c of ['ligacao', 'whatsapp', 'sms', 'email'] as const) {
    await db.insert(clienteCanal).values({ clienteId, canal: c, ativo: entrada.canais[c] ?? false })
  }
  marcar(
    4,
    'Ligar WhatsApp e SMS',
    entrada.canais.whatsapp || entrada.canais.sms ? 'feito' : 'pulado',
    'entrou no roteamento dos números da Avexa, sem cadastro novo',
  )

  // 3. O número de telefone do cliente.
  //
  // Vale para ligação E SMS: o lead tem que ver o mesmo número nos dois, e
  // receber mensagem de um número e ligação de outro parece golpe. Antes isto
  // só rodava quando voz era contratada, e gravava só no canal de ligação —
  // cliente só de SMS ficava sem número, e quem tinha voz tinha o número
  // gravado onde o envio de SMS não olhava.
  const querTelefone = !!(entrada.canais.ligacao || entrada.canais.sms)
  const escolha = opcoes.numero ?? { modo: 'pool' as const }

  if (!querTelefone) {
    marcar(3, 'Número do cliente', 'pulado', 'nem voz nem SMS contratados')
  } else if (escolha.modo === 'comprar') {
    if (!opcoes.twilio) {
      marcar(3, 'Número do cliente', 'falhou', 'comprar exige credenciais do Twilio')
      avisos.push('Sem credenciais do Twilio não dá para comprar número: ligação e SMS não saem.')
    } else {
      const r = await provisionarNumero(
        db,
        opcoes.twilio,
        { pais: escolha.pais ?? paisCliente, clienteId, apelido: `Avexa · ${entrada.nome}` },
        opcoes.webhookSms ?? null,
      )
      if (r.ok) {
        marcar(3, 'Número do cliente', 'feito', `${r.e164} · comprado agora e já atribuído`)
      } else {
        marcar(3, 'Número do cliente', 'falhou', r.erro)
        avisos.push(`A compra do número falhou (${r.erro}). Ligação e SMS não saem até resolver.`)
      }
    }
  } else if (escolha.modo === 'existente') {
    const [alvo] = await db.select().from(numero).where(eq(numero.e164, escolha.e164)).limit(1)
    if (!alvo) {
      marcar(3, 'Número do cliente', 'falhou', `${escolha.e164} não está cadastrado`)
      avisos.push(`O número ${escolha.e164} não existe no sistema. Ligação e SMS não saem.`)
    } else if (alvo.clienteId && alvo.clienteId !== clienteId) {
      // Dois clientes no mesmo número misturaria as respostas dos leads: o
      // webhook só traz o número, não o cliente.
      marcar(3, 'Número do cliente', 'falhou', `${escolha.e164} já é de outro cliente`)
      avisos.push(`O número ${escolha.e164} já pertence a outro cliente e não foi reatribuído.`)
    } else {
      await db
        .update(numero)
        .set({ status: 'atribuido', clienteId })
        .where(eq(numero.id, alvo.id))
      await definirRemetente(db, clienteId, alvo.e164)
      const doPais = paisDoTelefone(alvo.e164) === paisCliente
      marcar(
        3,
        'Número do cliente',
        'feito',
        `${alvo.e164}${doPais ? '' : ` · não é de ${paisCliente}`}`,
      )
      if (!doPais) avisos.push(avisoDePais(alvo.e164, paisCliente))
    }
  } else {
    const livres = await db.select().from(numero).where(eq(numero.status, 'livre'))
    // Prefere um número do país do cliente: ligar para um lead americano de um
    // número australiano derruba a taxa de atendimento. Só cai em outro país se
    // não houver escolha, e nesse caso o passo diz isso em vez de ficar calado.
    const doPais = livres.find((n) => paisDoTelefone(n.e164) === paisCliente)
    const livre = doPais ?? livres[0]
    if (livre) {
      await db
        .update(numero)
        .set({ status: 'atribuido', clienteId })
        .where(eq(numero.id, livre.id))
      await definirRemetente(db, clienteId, livre.e164)
      marcar(
        3,
        'Número do cliente',
        'feito',
        doPais
          ? `${livre.e164} · do pool, serve ligação e SMS`
          : `${livre.e164} · nenhum número de ${paisCliente} livre no pool`,
      )
      if (!doPais) avisos.push(avisoDePais(livre.e164, paisCliente))
    } else {
      // Pool vazio não invalida a ativação: o resto funciona e alguém repõe.
      marcar(3, 'Número do cliente', 'falhou', 'nenhum número livre no pool')
      avisos.push(
        'Nenhum número livre no pool: ligação e SMS não saem até alguém repor ou comprar.',
      )
    }
  }

  // 5 e 6. Templates e roteiros, com as variáveis já preenchidas.
  const valores = { produto: entrada.produto, cliente: entrada.nome }
  let criados = 0
  let pendentesMeta = 0
  for (const m of MODELOS_AVEXA) {
    if (!entrada.canais[m.canal]) continue
    await db.insert(template).values({
      clienteId,
      canal: m.canal,
      nome: m.nome,
      corpo: m.corpo,
      assunto: m.assunto ?? null,
      variaveis: { ...m.variaveis, produto: entrada.produto },
      status: m.aprovaSozinho ? 'aprovado' : 'rascunho',
      ...(m.aprovaSozinho ? { hashAprovado: null } : {}),
    })
    criados++
    if (!m.aprovaSozinho) pendentesMeta++
  }
  marcar(
    5,
    'Criar os templates',
    'feito',
    `${criados} modelos da Avexa, com a marca do cliente${
      pendentesMeta > 0 ? ` · ${pendentesMeta} aguardando aprovação da Meta` : ''
    }`,
  )

  // O número de WhatsApp é da marca Avexa e não exige cadastro novo — mas cada
  // template passa pela Meta. Até a aprovação sair, o motor pula a etapa de
  // WhatsApp, e é melhor dizer isso agora do que deixar descobrir no primeiro
  // lead que não recebeu mensagem nenhuma.
  if (entrada.canais.whatsapp && pendentesMeta > 0) {
    avisos.push(
      `WhatsApp não dispara ainda: ${pendentesMeta} template(s) aguardam aprovação da Meta. Submeta na aba Templates; o fluxo segue pelos outros canais até lá.`,
    )
  }

  const roteiros = entrada.canais.ligacao
    ? Object.entries(ROTEIROS_AVEXA).map(([k, v]) => `${k}: ${renderizar(v, valores).texto}`)
    : []
  marcar(
    6,
    'Gerar roteiro e textos',
    entrada.canais.ligacao ? 'feito' : 'pulado',
    entrada.canais.ligacao
      ? `${roteiros.length} roteiros prontos para revisão do copywriter`
      : 'voz não contratada',
  )

  // 7. Montar os fluxos, e com eles as URLs de entrada (passo 2).
  const nomesFluxo = ['Lead novo do site', ...(entrada.fluxosExtras ?? [])]
  for (const nome of nomesFluxo) {
    const fslug = nome === 'Lead novo do site' ? 'lead-novo' : paraSlug(nome)
    const grafo = fluxoPadrao(slug, entrada.canais)
    if (fslug !== 'lead-novo' && grafo[0]) {
      grafo[0].cfg.url = urlDeEntrada(slug, fslug)
    }

    const [f] = await db
      .insert(fluxo)
      .values({ clienteId, nome, slug: fslug, status: 'publicado' })
      .returning({ id: fluxo.id })
    const [v] = await db
      .insert(fluxoVersao)
      .values({ fluxoId: f!.id, versao: 1, grafo, publicadaEm: new Date() })
      .returning({ id: fluxoVersao.id })
    await db.update(fluxo).set({ versaoPublicadaId: v!.id }).where(eq(fluxo.id, f!.id))

    urls.push({ fluxo: nome, url: urlDeEntrada(slug, fslug) })
  }
  marcar(2, 'Gerar as URLs de entrada', 'feito', `${urls.length} endereço(s), um por fluxo`)
  marcar(7, 'Montar os fluxos', 'feito', `canais no fluxo: ${canais.join(', ') || 'nenhum'}`)

  // Destino de entrega.
  if (entrada.emailDoTime) {
    await db.insert(integracao).values({
      clienteId,
      tipo: 'email_time',
      nome: 'Time comercial',
      config: { para: entrada.emailDoTime },
    })
  }

  await db.update(cliente).set({ status: 'ativo' }).where(eq(cliente.id, clienteId))

  if (!entrada.emailDoTime) {
    avisos.push('Sem e-mail do time: o lead qualificado não tem para onde ser entregue.')
  }

  passos.sort((a, b) => a.n - b.n)
  return { ok: true, clienteId, passos, urls, avisos }
}
