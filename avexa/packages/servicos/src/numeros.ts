import { and, eq } from 'drizzle-orm'
import { cliente, projetoCanal, numero, projeto, type Db } from '@avexa/db'
import {
  apontarWebhookSms,
  buscarNumerosDisponiveis,
  comprarNumero,
  listarNumerosDaConta,
  renomearNumero as renomearNoTwilio,
  type CredenciaisTwilio,
  type NumeroDisponivel,
  type TipoDeNumero,
} from '@avexa/adapters'
import { apelidoPadrao, cruzar, type NumeroInventariado } from './inventario.ts'

/** Números de telefone: comprar, guardar e atribuir a cliente.
 *
 *  Cada cliente fala do próprio número — o lead reconhece quem o procurou, e o
 *  SMS sai do mesmo número que liga. O pool existe para que a atribuição na
 *  ativação seja instantânea; comprar na hora atrasaria a ativação e deixaria
 *  o operador esperando o Twilio. */

export function credenciaisDoAmbiente(
  env: Record<string, string | undefined> = process.env,
): CredenciaisTwilio | null {
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN) return null
  return { accountSid: env.TWILIO_ACCOUNT_SID, authToken: env.TWILIO_AUTH_TOKEN }
}

/** A URL para onde o Twilio manda resposta e opt-out do lead.
 *
 *  Sai de DOMINIO, a mesma identidade canônica que o painel usa. Um número
 *  comprado sem webhook recebe mensagem e joga fora em silêncio — e o pedido
 *  de parada de um lead é a mensagem que menos se pode perder. */
export function webhookDeSms(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const dominio = env.DOMINIO?.trim().replace(/\/+$/, '')
  return dominio ? `https://${dominio}/api/webhooks/sms` : null
}

export type ResultadoProvisionar =
  | { ok: true; e164: string; sid: string; atribuido: boolean }
  | { ok: false; erro: string }

/** Ordem de procura. Local primeiro porque é o mais barato e o mais comum;
 *  Mobile logo atrás porque na Austrália é ele que manda SMS, e procurar só
 *  em Local faria a compra falhar dizendo que não há número no país. */
const TIPOS: TipoDeNumero[] = ['Local', 'Mobile', 'TollFree']

export interface PedidoDeNumero {
  pais: string
  contem?: string
  /** Já deixa o número reservado para este cliente e o põe como remetente dos
   *  canais de telefone dele. Sem isto, entra no pool como livre. */
  clienteId?: string
  /** Frente do cliente que vai falar por este número. Dá o nome do número no
   *  console do Twilio. */
  projetoId?: string
  /** Sobrepõe o nome derivado de cliente e projeto. Só para quem sabe o que
   *  está fazendo: o padrão é o que mantém a conta legível. */
  apelido?: string
}

/** Compra um número no Twilio e registra no banco.
 *
 *  Gasta dinheiro de verdade, todo mês, por número. */
export async function provisionarNumero(
  db: Db,
  cred: CredenciaisTwilio,
  p: PedidoDeNumero,
  webhook?: string | null,
): Promise<ResultadoProvisionar> {
  let escolhido: NumeroDisponivel | null = null
  let ultimoErro = ''

  for (const tipo of TIPOS) {
    const r = await buscarNumerosDisponiveis(cred, {
      pais: p.pais,
      tipo,
      exigeVoz: true,
      limite: 5,
      ...(p.contem ? { contem: p.contem } : {}),
    })
    if (!r.ok) {
      ultimoErro = r.erro
      continue
    }
    escolhido = escolher(r.numeros)
    if (escolhido) break
  }

  if (!escolhido) {
    return {
      ok: false,
      erro:
        `nenhum número com voz e SMS disponível em ${p.pais.toUpperCase()}` +
        (ultimoErro ? ` (${ultimoErro})` : '') +
        '. Confira o cadastro regulatório e o endereço da conta no console do Twilio.',
    }
  }

  // O nome sai daqui e não do console: número comprado sem nome entra na conta
  // como mais uma linha de dígitos, e ninguém volta depois para batizar.
  const apelido = p.apelido?.trim() || (await apelidoDe(db, p.clienteId, p.projetoId))

  const compra = await comprarNumero(cred, {
    e164: escolhido.e164,
    ...(webhook ? { webhookSms: webhook } : {}),
    ...(apelido ? { apelido } : {}),
  })
  if (!compra.ok) return { ok: false, erro: compra.erro }

  // O número já é nosso e já custa. Se o registro falhar daqui para a frente,
  // ele existe no Twilio e não no banco — por isso grava antes de atribuir.
  await db
    .insert(numero)
    .values({
      e164: compra.numero.e164,
      provedor: 'twilio',
      provedorSid: compra.numero.sid,
      capacidades: compra.numero.capacidades,
      status: p.clienteId ? 'atribuido' : 'livre',
      ...(p.clienteId ? { clienteId: p.clienteId } : {}),
      ...(p.projetoId ? { projetoId: p.projetoId } : {}),
    })
    .onConflictDoNothing()

  if (p.clienteId) {
    await definirRemetente(db, p.clienteId, compra.numero.e164)
  }

  return { ok: true, e164: compra.numero.e164, sid: compra.numero.sid, atribuido: !!p.clienteId }
}

/** Prefere quem tem voz E SMS: o motor liga e manda SMS do mesmo número, e um
 *  número só de SMS quebraria a etapa de voz sem aviso. */
export function escolher(numeros: NumeroDisponivel[]): NumeroDisponivel | null {
  const completo = numeros.find(
    (n) => n.capacidades.includes('voz') && n.capacidades.includes('sms'),
  )
  return completo ?? null
}

/** Põe o número como remetente dos canais de telefone do cliente.
 *
 *  SMS e ligação juntos, de propósito: o lead precisa ver o mesmo número nos
 *  dois. Receber SMS de um número e ligação de outro parece golpe. */
export async function definirRemetente(db: Db, projetoId: string, e164: string): Promise<void> {
  for (const canal of ['sms', 'ligacao'] as const) {
    const [linha] = await db
      .select({ id: projetoCanal.id, config: projetoCanal.config })
      .from(projetoCanal)
      .where(and(eq(projetoCanal.projetoId, projetoId), eq(projetoCanal.canal, canal)))
      .limit(1)

    if (linha) {
      await db
        .update(projetoCanal)
        .set({ config: { ...linha.config, numero: e164 } })
        .where(eq(projetoCanal.id, linha.id))
    } else {
      // O canal pode não existir ainda se o número for comprado antes da
      // ativação. Nasce desligado: comprar número não é contratar canal.
      await db
        .insert(projetoCanal)
        .values({ projetoId, canal, ativo: false, config: { numero: e164 } })
    }
  }
}

/** Reaponta o webhook de todos os números para o domínio atual.
 *
 *  Um número apontando para um domínio velho recebe o opt-out do lead e o
 *  entrega em lugar nenhum. */
export async function reapontarWebhooks(
  db: Db,
  cred: CredenciaisTwilio,
  webhook: string,
): Promise<Array<{ e164: string; ok: boolean; erro?: string }>> {
  const todos = await db
    .select({ e164: numero.e164, sid: numero.provedorSid })
    .from(numero)
    .where(eq(numero.provedor, 'twilio'))

  const saida: Array<{ e164: string; ok: boolean; erro?: string }> = []
  for (const n of todos) {
    if (!n.sid) {
      saida.push({ e164: n.e164, ok: false, erro: 'sem SID: número não veio desta automação' })
      continue
    }
    const r = await apontarWebhookSms(cred, n.sid, webhook)
    saida.push({ e164: n.e164, ...r })
  }
  return saida
}

/** O nome que um número deve ter, dado a quem ele pertence. */
async function apelidoDe(
  db: Db,
  clienteId?: string,
  projetoId?: string,
): Promise<string | null> {
  if (!clienteId) return null
  const [c] = await db
    .select({ nome: cliente.nome })
    .from(cliente)
    .where(eq(cliente.id, clienteId))
    .limit(1)
  if (!c) return null

  let nomeProjeto: string | null = null
  if (projetoId) {
    const [p] = await db
      .select({ nome: projeto.nome })
      .from(projeto)
      .where(eq(projeto.id, projetoId))
      .limit(1)
    nomeProjeto = p?.nome ?? null
  }
  return apelidoPadrao(c.nome, nomeProjeto)
}

export type ResultadoInventarioNumeros =
  | { ok: true; numeros: NumeroInventariado[] }
  | { ok: false; erro: string }

/** O que a conta do Twilio tem de verdade, ao lado do que a Avexa acha que tem.
 *
 *  Lê o Twilio a cada chamada em vez de guardar cópia. Cópia envelhece — alguém
 *  compra ou renomeia um número no console e o painel continua mostrando o
 *  estado de ontem com cara de atual. Aqui a lentidão é honesta e o erro é
 *  visível. */
export async function inventarioDeNumeros(
  db: Db,
  cred: CredenciaisTwilio,
): Promise<ResultadoInventarioNumeros> {
  const [r, nossos] = await Promise.all([
    listarNumerosDaConta(cred),
    db
      .select({
        e164: numero.e164,
        provedorSid: numero.provedorSid,
        status: numero.status,
        clienteId: projeto.clienteId,
        clienteNome: cliente.nome,
        projetoId: numero.projetoId,
        projetoNome: projeto.nome,
      })
      .from(numero)
      // O cliente do número sai pelo projeto: é a única cadeia de dono, e ter
      // uma segunda coluna de dono faria as duas divergirem em silêncio.
      .leftJoin(projeto, eq(numero.projetoId, projeto.id))
      .leftJoin(cliente, eq(projeto.clienteId, cliente.id)),
  ])

  if (!r.ok) return { ok: false, erro: r.erro }
  return { ok: true, numeros: cruzar(r.numeros, nossos) }
}

export type ResultadoNumero = { ok: true; aviso?: string } | { ok: false; erro: string }

/** Troca o nome de um número no Twilio.
 *
 *  Vale para qualquer número da conta, inclusive os da operação antiga: é
 *  justamente neles que o nome é a única pista de dono. */
export async function renomear(
  cred: CredenciaisTwilio,
  sid: string,
  apelido: string,
): Promise<ResultadoNumero> {
  if (!sid) {
    return {
      ok: false,
      erro: 'este número não existe no Twilio, então não há nome para trocar lá.',
    }
  }
  const r = await renomearNoTwilio(cred, sid, apelido)
  return r.ok ? { ok: true } : { ok: false, erro: r.erro ?? 'falha ao renomear' }
}

export interface AdocaoDeNumero {
  sid: string
  e164: string
  /** A frente que passa a falar por este número. O cliente sai dela. */
  projetoId: string
  capacidades?: string[]
  /** Renomeia no Twilio para o padrão cliente · projeto. */
  renomear?: boolean
}

/** Traz para a Avexa um número que já existe na conta do Twilio.
 *
 *  É a ponte com a operação antiga: o número já está comprado e já custa, e
 *  recomprar seria pagar duas vezes pela mesma coisa.
 *
 *  REAPONTA O WEBHOOK DE SMS para a Avexa, e isso tem consequência do outro
 *  lado: o que quer que receba as respostas deste número hoje para de receber.
 *  Não dá para adotar pela metade — um número atribuído a um cliente cujo
 *  opt-out continua chegando em outro lugar é pior do que não adotar, porque o
 *  lead pede para parar e a Avexa não fica sabendo. Quem chama precisa ter
 *  avisado antes; o aviso volta no resultado para ser repetido na tela. */
export async function adotarNumero(
  db: Db,
  cred: CredenciaisTwilio,
  a: AdocaoDeNumero,
  webhook?: string | null,
): Promise<ResultadoNumero> {
  const [dono] = await db
    .select({ projetoId: numero.projetoId })
    .from(numero)
    .where(eq(numero.e164, a.e164))
    .limit(1)

  if (dono?.projetoId && dono.projetoId !== a.projetoId) {
    // Dois projetos no mesmo número misturariam as respostas: o webhook traz o
    // número, e não há como saber de qual frente é o lead que respondeu.
    return { ok: false, erro: 'este número já é de outro projeto na Avexa.' }
  }

  const [p] = await db
    .select({ cliente: cliente.nome, projeto: projeto.nome })
    .from(projeto)
    .innerJoin(cliente, eq(projeto.clienteId, cliente.id))
    .where(eq(projeto.id, a.projetoId))
    .limit(1)
  if (!p) return { ok: false, erro: 'projeto não encontrado' }

  const valores = {
    provedor: 'twilio',
    provedorSid: a.sid,
    status: 'atribuido' as const,
    projetoId: a.projetoId,
    // Grava sempre, inclusive vazio: o que o Twilio diz agora é a verdade, e
    // manter uma capacidade antiga porque a nova veio vazia é exatamente como
    // um número deixa de mandar SMS sem ninguém notar.
    capacidades: a.capacidades ?? [],
  }

  await db
    .insert(numero)
    .values({ e164: a.e164, ...valores })
    .onConflictDoUpdate({ target: numero.e164, set: valores })

  await definirRemetente(db, a.projetoId, a.e164)

  // O webhook vem depois do banco de propósito: se ele falhar, o número já está
  // registrado e o erro é visível e refazível. Na ordem inversa, o número
  // apontaria para a Avexa sem a Avexa saber que ele existe.
  const avisos: string[] = []
  if (webhook) {
    const r = await apontarWebhookSms(cred, a.sid, webhook)
    if (!r.ok) {
      avisos.push(
        `O número foi adotado, mas o webhook de SMS não foi apontado (${r.erro}). ` +
          'Até isso ser resolvido, resposta e opt-out do lead não chegam.',
      )
    }
  } else {
    avisos.push('Sem DOMINIO configurado, o webhook de SMS não foi apontado.')
  }

  if (a.renomear !== false) {
    const r = await renomearNoTwilio(cred, a.sid, apelidoPadrao(p.cliente, p.projeto))
    if (!r.ok) avisos.push(`O nome no Twilio não foi trocado (${r.erro}).`)
  }

  return avisos.length > 0 ? { ok: true, aviso: avisos.join(' ') } : { ok: true }
}
