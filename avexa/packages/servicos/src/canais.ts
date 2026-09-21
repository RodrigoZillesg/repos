import { and, eq } from 'drizzle-orm'
import { agenteVoz, cliente, clienteCanal, fluxo, fluxoVersao, type Db } from '@avexa/db'
import { ETAPAS, type Canal, type Etapa, type Grafo } from '@avexa/core'

/** Ligar e desligar canal de um cliente depois da ativação.
 *
 *  A ativação era a única chance de decidir isso, e não devia ser: cliente
 *  contrata SMS no segundo mês, desiste de ligação, muda de ideia. Mas ligar um
 *  canal não é virar uma chave — cada um tem um pré-requisito diferente, e
 *  ligar sem ele produz o pior resultado possível: o painel diz que o canal
 *  está ativo, o fluxo tem a etapa, e nenhum contato sai. Silêncio.
 *
 *  Por isso o estado de cada canal é "pronto" ou "falta X", e desligar avisa
 *  quantos fluxos publicados dependem dele. */

export const CANAIS: readonly Canal[] = ['ligacao', 'whatsapp', 'sms', 'email']

export interface EstadoCanal {
  canal: Canal
  ativo: boolean
  /** Dá para ligar agora? Quando `false`, `falta` diz o que resolver. */
  pronto: boolean
  falta: string | null
  /** O número do cliente, quando o canal usa um. */
  numero: string | null
  /** Quantos fluxos publicados têm uma etapa deste canal. Desligar cala todos. */
  fluxosPublicados: number
}

/** Canais cujo contato sai do número do próprio cliente.
 *
 *  WhatsApp e e-mail saem de um remetente único da Avexa — o WhatsApp pela
 *  WABA, o e-mail pelo domínio verificado no Resend. Ligar esses dois é só
 *  contratar; os outros dois precisam de número. */
const PRECISAM_DE_NUMERO = new Set<Canal>(['ligacao', 'sms'])

/** Conta as etapas de um canal dentro da árvore, ramos e corpo incluídos. */
function usaCanal(grafo: Grafo, canal: Canal): boolean {
  const olhar = (lista: Etapa[]): boolean =>
    lista.some((e) => {
      if (ETAPAS[e.tipo]?.canal === canal) return true
      return (['sim', 'nao', 'corpo'] as const).some((r) => (e[r] ? olhar(e[r]!) : false))
    })
  return olhar(grafo)
}

export async function estadoDosCanais(db: Db, clienteId: string): Promise<EstadoCanal[]> {
  const [linhas, agente, publicados] = await Promise.all([
    db.select().from(clienteCanal).where(eq(clienteCanal.clienteId, clienteId)),
    db
      .select({ vapiAssistantId: agenteVoz.vapiAssistantId })
      .from(agenteVoz)
      .where(eq(agenteVoz.clienteId, clienteId))
      .limit(1),
    // Só as versões que estão no ar: um rascunho com etapa de WhatsApp não é
    // motivo para hesitar em desligar o WhatsApp.
    db
      .select({ grafo: fluxoVersao.grafo })
      .from(fluxo)
      .innerJoin(fluxoVersao, eq(fluxo.versaoPublicadaId, fluxoVersao.id))
      .where(eq(fluxo.clienteId, clienteId)),
  ])

  const porCanal = new Map(linhas.map((l) => [l.canal as Canal, l]))
  const grafos = publicados.map((p) => (p.grafo ?? []) as Grafo)
  // O número é o mesmo para voz e SMS, e `definirRemetente` grava nos dois.
  const numero =
    CANAIS.map((c) => porCanal.get(c)?.config?.numero).find(
      (v): v is string => typeof v === 'string' && v.trim() !== '',
    ) ?? null
  const vozNaVapi = typeof porCanal.get('ligacao')?.config?.vozId === 'string'
  const agentePublicado = Boolean(agente[0]?.vapiAssistantId)

  return CANAIS.map((canal) => {
    const linha = porCanal.get(canal)
    const ativo = linha?.ativo ?? false

    let falta: string | null = null
    if (PRECISAM_DE_NUMERO.has(canal) && !numero) {
      falta = 'este cliente não tem número. Atribua um antes de ligar o canal.'
    } else if (canal === 'ligacao' && !agentePublicado) {
      falta = 'o agente de voz ainda não foi publicado na Vapi.'
    } else if (canal === 'ligacao' && !vozNaVapi) {
      falta = 'o número existe no Twilio mas não foi importado na Vapi — sem isso a ligação não sai.'
    }

    return {
      canal,
      ativo,
      pronto: falta === null,
      falta,
      numero: PRECISAM_DE_NUMERO.has(canal) ? numero : null,
      fluxosPublicados: grafos.filter((g) => usaCanal(g, canal)).length,
    }
  })
}

export type ResultadoCanal = { ok: true; aviso?: string } | { ok: false; erro: string }

/** Liga ou desliga um canal.
 *
 *  Ligar é recusado quando o pré-requisito falta, porque um canal "ativo" sem
 *  número é uma etapa que o motor pula em silêncio — e ninguém descobre isso
 *  olhando a tela, só percebendo que o lead não foi contatado.
 *
 *  Desligar nunca é recusado: é o cliente que decide o que contratou. Mas volta
 *  um aviso quando há fluxo publicado dependendo dele, porque a consequência
 *  acontece na próxima entrada de lead, não na hora do clique. */
export async function definirCanal(
  db: Db,
  clienteId: string,
  canal: Canal,
  ativo: boolean,
): Promise<ResultadoCanal> {
  if (!CANAIS.includes(canal)) return { ok: false, erro: `canal desconhecido: ${canal}` }

  const estados = await estadoDosCanais(db, clienteId)
  const estado = estados.find((e) => e.canal === canal)
  if (!estado) return { ok: false, erro: 'cliente não encontrado' }
  if (estado.ativo === ativo) return { ok: true }

  if (ativo && !estado.pronto) {
    return { ok: false, erro: `Não dá para ligar ${canal} agora: ${estado.falta}` }
  }

  const [linha] = await db
    .select({ id: clienteCanal.id })
    .from(clienteCanal)
    .where(and(eq(clienteCanal.clienteId, clienteId), eq(clienteCanal.canal, canal)))
    .limit(1)

  if (linha) {
    await db.update(clienteCanal).set({ ativo }).where(eq(clienteCanal.id, linha.id))
  } else {
    // Cliente ativado antes deste canal existir não tem a linha. Criar é mais
    // honesto do que falhar: o canal passa a existir desligado por padrão.
    await db.insert(clienteCanal).values({ clienteId, canal, ativo })
  }

  if (!ativo && estado.fluxosPublicados > 0) {
    return {
      ok: true,
      aviso:
        estado.fluxosPublicados === 1
          ? 'Um fluxo publicado usa este canal. A etapa passa a ser pulada na próxima entrada de lead.'
          : `${estado.fluxosPublicados} fluxos publicados usam este canal. As etapas passam a ser puladas na próxima entrada de lead.`,
    }
  }
  return { ok: true }
}

export interface CadastroDoCliente {
  nome: string
  fusoHorario: string
  pais: string
  dryRun: boolean
}

/** O que dá para corrigir depois da ativação sem quebrar nada.
 *
 *  O `slug` fica de fora de propósito: ele compõe a URL de webhook que o
 *  cliente já colou no formulário dele. Trocar mataria a entrada de leads sem
 *  aviso — e o sintoma seria "parou de chegar lead", que é o mais caro de
 *  diagnosticar. */
export async function salvarCliente(
  db: Db,
  clienteId: string,
  d: CadastroDoCliente,
): Promise<ResultadoCanal> {
  const nome = d.nome.trim()
  if (!nome) return { ok: false, erro: 'o cliente precisa de um nome' }
  // Fuso inválido faria toda decisão de janela de contato cair no fuso errado:
  // ligar às 3 da manhã na casa de alguém.
  try {
    new Intl.DateTimeFormat('en', { timeZone: d.fusoHorario })
  } catch {
    return { ok: false, erro: `fuso horário desconhecido: ${d.fusoHorario}` }
  }
  if (!/^[A-Z]{2}$/.test(d.pais)) return { ok: false, erro: 'país precisa ser a sigla de dois letras' }

  await db
    .update(cliente)
    .set({ nome, fusoHorario: d.fusoHorario, pais: d.pais, dryRun: d.dryRun, atualizadoEm: new Date() })
    .where(eq(cliente.id, clienteId))

  return d.dryRun
    ? { ok: true }
    : {
        ok: true,
        aviso: 'Modo seco desligado: a partir de agora os contatos saem de verdade.',
      }
}
