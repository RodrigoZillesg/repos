'use server'

import { revalidatePath } from 'next/cache'
import { and, eq } from 'drizzle-orm'
import { auditoria, cliente, db, integracao } from '@avexa/db'
import {
  entregarWebhook,
  type AgendaDoGoogle,
  type PipelineHubspot,
} from '@avexa/adapters'
import {
  definirDestino,
  definirWebhookDoCliente,
  desconectarCalendly,
  desconectarGoogle,
  desconectarHubspot,
  criarPipelineDoCliente,
  listarAgendasDoCliente,
  listarTiposDeEvento,
  pipelinesDoCliente,
  webhookDoCliente,
  type TipoGoogle,
  type TipoOAuth,
} from '@avexa/servicos'
import type { ProvedorAgenda } from '@avexa/core'
import { sessaoAtual } from '@/lib/auth'

async function exigirAdmin() {
  const s = await sessaoAtual()
  return s?.permissoes.administrar ? s : null
}

export type TipoIntegracao = TipoOAuth | 'webhook' | 'email_time'

export async function desligar(clienteId: string, tipo: TipoIntegracao): Promise<{ ok: boolean }> {
  if (!(await exigirAdmin())) return { ok: false }
  if (tipo === 'calendly') await desconectarCalendly(db(), clienteId)
  else if (tipo === 'hubspot') await desconectarHubspot(db(), clienteId)
  else if (tipo === 'webhook' || tipo === 'email_time') {
    await db().delete(integracao).where(and(eq(integracao.clienteId, clienteId), eq(integracao.tipo, tipo)))
  } else await desconectarGoogle(db(), clienteId, tipo as TipoGoogle)
  revalidatePath('/integracoes')
  return { ok: true }
}

export async function salvarStatusHubspot(
  clienteId: string,
  qualificado: string,
  naoQualificado: string,
): Promise<{ ok: boolean }> {
  if (!(await exigirAdmin())) return { ok: false }
  await definirDestino(db(), clienteId, 'hubspot', {
    statusQualificado: qualificado || null,
    statusNaoQualificado: naoQualificado || null,
  })
  revalidatePath('/integracoes')
  return { ok: true }
}

/* ------------------------- Pipelines do HubSpot --------------------------- */

export async function buscarPipelines(
  clienteId: string,
): Promise<{ pipelines: PipelineHubspot[] } | { erro: string }> {
  if (!(await exigirAdmin())) return { erro: 'sem permissão' }
  const r = await pipelinesDoCliente(db(), clienteId)
  return 'erro' in r ? r : { pipelines: r }
}

/** Para qual pipeline e estágio o lead vai, por qualificação.
 *
 *  Estágio em branco quer dizer "não abrir negócio". É a saída para o cliente
 *  que não quer o lead frio entrando no funil dele. */
export async function salvarFunilHubspot(
  clienteId: string,
  pipeline: string,
  estagioQualificado: string,
  estagioNaoQualificado: string,
  nome = '',
): Promise<{ ok: boolean }> {
  if (!(await exigirAdmin())) return { ok: false }
  await definirDestino(db(), clienteId, 'hubspot', {
    pipeline: pipeline || null,
    // O nome, para a tela abrir dizendo em qual funil o lead cai sem precisar
    // buscar no HubSpot: o id sozinho é um número que não significa nada.
    pipelineNome: pipeline ? nome || null : null,
    estagioQualificado: estagioQualificado || null,
    estagioNaoQualificado: estagioNaoQualificado || null,
  })
  revalidatePath('/integracoes')
  return { ok: true }
}

/** Cria um pipeline no portal do cliente.
 *
 *  Escreve na estrutura do CRM de outra empresa — por isso fica em auditoria
 *  com quem pediu. Um pipeline a mais não some sozinho: alguém do cliente vai
 *  encontrá-lo lá e perguntar de onde veio. */
export async function criarPipeline(
  clienteId: string,
  nome: string,
): Promise<{ ok: true; pipeline: PipelineHubspot } | { ok: false; erro: string }> {
  const s = await exigirAdmin()
  if (!s) return { ok: false, erro: 'sem permissão' }

  const r = await criarPipelineDoCliente(db(), clienteId, nome)
  if ('erro' in r) return { ok: false, erro: r.erro }

  await db().insert(auditoria).values({
    usuarioId: s.usuarioId,
    clienteId,
    acao: 'hubspot.pipeline.criar',
    entidade: 'integracao',
    entidadeId: r.id,
    detalhe: { nome: r.rotulo, estagios: r.estagios.map((x) => x.rotulo) },
  })

  revalidatePath('/integracoes')
  return { ok: true, pipeline: r }
}

/** Salva a URL do webhook. O segredo volta uma vez e não é mostrado de novo. */
export async function salvarWebhook(
  clienteId: string,
  url: string,
  regerar: boolean,
): Promise<{ ok: boolean; segredo?: string; erro?: string }> {
  if (!(await exigirAdmin())) return { ok: false, erro: 'sem permissão' }
  const r = await definirWebhookDoCliente(db(), clienteId, url.trim(), regerar)
  revalidatePath('/integracoes')
  return r
}

/** Manda uma carga de exemplo, assinada igual à de verdade.
 *
 *  Vale mais do que parece: quase toda integração de cliente quebra na primeira
 *  entrega real, e descobrir isso com um lead quente na mão é caro. */
export async function testarWebhook(
  clienteId: string,
): Promise<{ ok: boolean; status: number; erro?: string }> {
  if (!(await exigirAdmin())) return { ok: false, status: 0, erro: 'sem permissão' }
  const alvo = await webhookDoCliente(db(), clienteId)
  if (!alvo) return { ok: false, status: 0, erro: 'webhook sem URL' }

  const entregaId = `teste-${Date.now()}`
  const r = await entregarWebhook({
    url: alvo.url,
    corpo: {
      tipo: 'lead.teste',
      entregaId,
      dados: {
        id: '00000000-0000-0000-0000-000000000000',
        nome: 'Lead de teste da Avexa',
        telefone: '+61400000000',
        email: 'teste@avexa.global',
        score: 87,
        motivo: 'carga de exemplo, nenhum lead real',
        resumo: 'Mensagem de teste disparada pelo painel.',
        etiquetas: ['teste'],
        campos: {},
        utm: {},
        criadoEm: new Date().toISOString(),
        urgente: false,
      },
    },
    segredo: alvo.segredo ?? undefined,
    entregaId,
    // Teste não insiste: o operador está olhando a tela agora.
    tentativas: 1,
    timeoutMs: 10_000,
  })
  return { ok: r.ok, status: r.status, ...(r.erro ? { erro: r.erro } : {}) }
}

export async function salvarEmailTime(
  clienteId: string,
  para: string,
): Promise<{ ok: boolean; erro?: string }> {
  if (!(await exigirAdmin())) return { ok: false, erro: 'sem permissão' }
  const endereco = para.trim()
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(endereco)) {
    return { ok: false, erro: 'endereço inválido' }
  }

  const d = db()
  const [linha] = await d
    .select()
    .from(integracao)
    .where(and(eq(integracao.clienteId, clienteId), eq(integracao.tipo, 'email_time')))
    .limit(1)

  if (linha) {
    await d
      .update(integracao)
      .set({ config: { ...(linha.config ?? {}), para: endereco }, ativo: true })
      .where(eq(integracao.id, linha.id))
  } else {
    await d.insert(integracao).values({
      clienteId,
      tipo: 'email_time',
      nome: 'Time comercial',
      config: { para: endereco },
    })
  }

  revalidatePath('/integracoes')
  return { ok: true }
}

/** Guarda as agendas escolhidas, e também como elas se chamam.
 *
 *  O nome não é enfeite: o id de uma agenda de recurso ou de grupo é uma
 *  sequência ilegível, e sem o nome a tela mostraria ao operador algo que ele
 *  não reconhece como sendo o time do cliente dele. */
export async function salvarAgendas(
  clienteId: string,
  calendarios: string[],
  rodizio: boolean,
  nomes: Record<string, string> = {},
): Promise<{ ok: boolean }> {
  if (!(await exigirAdmin())) return { ok: false }
  const ids = [...new Set(calendarios.map((x) => x.trim()).filter(Boolean))]
  await definirDestino(db(), clienteId, 'google_calendar', {
    calendarios: ids,
    // Só os nomes do que ficou escolhido: guardar o resto seria uma cópia da
    // conta Google do cliente envelhecendo aqui dentro.
    calendariosNomes: Object.fromEntries(ids.map((id) => [id, nomes[id] ?? id])),
    rodizio,
  })
  revalidatePath('/integracoes')
  return { ok: true }
}

/** Lista as agendas da conta conectada, para a tela oferecer escolha. */
export async function buscarAgendas(
  clienteId: string,
): Promise<{ agendas: AgendaDoGoogle[] } | { erro: string }> {
  if (!(await exigirAdmin())) return { erro: 'sem permissão' }
  const r = await listarAgendasDoCliente(db(), clienteId)
  return 'erro' in r ? r : { agendas: r }
}

export async function salvarPlanilha(
  clienteId: string,
  planilhaId: string,
  aba: string,
): Promise<{ ok: boolean }> {
  if (!(await exigirAdmin())) return { ok: false }
  // Aceita a URL inteira: ninguém guarda o id de cabeça, e pedir só o id
  // garante que alguém vai colar a URL e ver "não funcionou".
  const id = /\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/.exec(planilhaId)?.[1] ?? planilhaId.trim()
  await definirDestino(db(), clienteId, 'google_sheets', { planilhaId: id, aba: aba.trim() || 'Leads' })
  revalidatePath('/integracoes')
  return { ok: true }
}

/** Guarda a URI e também como ela se chama.
 *
 *  A URI sozinha não diz nada a quem abre a tela depois — "conversa de 30 min"
 *  e "aula demonstrativa de 60" são escolhas diferentes, e conferir qual está
 *  valendo não deveria exigir uma ida ao Calendly. */
export async function salvarTipoDeEvento(
  clienteId: string,
  tipoDeEvento: string,
  nome?: string,
  duracaoMin?: number,
): Promise<{ ok: boolean }> {
  if (!(await exigirAdmin())) return { ok: false }
  await definirDestino(db(), clienteId, 'calendly', {
    tipoDeEvento,
    ...(nome ? { tipoDeEventoNome: nome } : {}),
    ...(duracaoMin ? { tipoDeEventoDuracao: duracaoMin } : {}),
  })
  revalidatePath('/integracoes')
  return { ok: true }
}

export async function buscarTiposDeEvento(
  clienteId: string,
): Promise<{ tipos: Array<{ uri: string; nome: string; duracaoMin: number }> } | { erro: string }> {
  if (!(await exigirAdmin())) return { erro: 'sem permissão' }
  const r = await listarTiposDeEvento(db(), clienteId)
  if ('erro' in r) return r
  return { tipos: r.map((t) => ({ uri: t.uri, nome: t.nome, duracaoMin: t.duracaoMin })) }
}

/** Qual ferramenta de agenda este cliente usa, quando as duas estão conectadas. */
export async function escolherProvedorAgenda(
  clienteId: string,
  provedor: ProvedorAgenda,
): Promise<{ ok: boolean }> {
  if (!(await exigirAdmin())) return { ok: false }
  await db().update(cliente).set({ provedorAgenda: provedor }).where(eq(cliente.id, clienteId))
  revalidatePath('/integracoes')
  return { ok: true }
}
