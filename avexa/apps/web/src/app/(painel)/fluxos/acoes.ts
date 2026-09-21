'use server'

import { revalidatePath } from 'next/cache'
import { and, desc, eq } from 'drizzle-orm'
import { cliente, db, fluxo, fluxoVersao, template } from '@avexa/db'
import { temErro, validarGrafo, type Achado, type Grafo } from '@avexa/core'
import { sessaoAtual } from '@/lib/auth'
import { canaisDoCliente, listarFluxos } from '@/lib/dados'

/** Salva um rascunho ou publica.
 *
 *  Publicar cria uma versão nova em vez de sobrescrever: um lead parado numa
 *  espera de três dias precisa terminar o fluxo em que entrou, não o que foi
 *  editado no meio do caminho. */
export interface ResultadoSalvar {
  ok: boolean
  /** Uma linha para o topo da tela. Os detalhes vão em `achados`. */
  erro?: string
  /** Todos os achados da validação, com `etapaId` — é o que permite marcar o
   *  nó que tem o problema em vez de descrever o problema por escrito.
   *
   *  Antes daqui só saía a primeira mensagem de erro, como texto solto: o
   *  operador corrigia, publicava, recebia o próximo. Um por vez, sem saber
   *  quantos faltavam nem em qual etapa. */
  achados?: Achado[]
}

export async function salvarFluxo(
  fluxoId: string,
  grafo: Grafo,
  publicar: boolean,
): Promise<ResultadoSalvar> {
  let avisos: Achado[] = []
  const s = await sessaoAtual()
  // A permissão é conferida aqui, no servidor. Botão escondido não é controle
  // de acesso: uma server action é um endpoint público.
  if (!s?.permissoes.editarFluxos) return { ok: false, erro: 'sem permissão' }

  const d = db()
  const [f] = await d.select().from(fluxo).where(eq(fluxo.id, fluxoId)).limit(1)
  if (!f) return { ok: false, erro: 'fluxo não encontrado' }

  const [c] = await d.select().from(cliente).where(eq(cliente.id, f.clienteId)).limit(1)
  if (!c) return { ok: false, erro: 'cliente não encontrado' }

  if (publicar) {
    const canais = await canaisDoCliente(c.id)
    const aprovados = await d
      .select({ canal: template.canal, nome: template.nome })
      .from(template)
      .where(and(eq(template.clienteId, c.id), eq(template.status, 'aprovado')))

    const porCanal: Record<string, string[]> = {}
    for (const a of aprovados) (porCanal[a.canal] ??= []).push(a.nome)

    const outros = (await listarFluxos(c.id))
      .filter((x) => x.id !== fluxoId)
      .map((x) => ({ id: x.id, nome: x.nome }))
    const achados = validarGrafo(grafo, {
      canaisAtivos: canais,
      templatesAprovados: porCanal,
      fluxosDoCliente: outros,
    })

    if (temErro(achados)) {
      const quantos = achados.filter((a) => a.gravidade === 'erro').length
      return {
        ok: false,
        erro:
          quantos === 1
            ? 'Um problema impede publicar.'
            : `${quantos} problemas impedem publicar.`,
        achados,
      }
    }
    // Sem erro os avisos sobem junto — canal não contratado, subfluxo por nome
    // — mas guardados para DEPOIS de publicar. Retornar aqui pularia a gravação
    // e reportaria sucesso sem ter salvo nada.
    avisos = achados
  }

  const [ultima] = await d
    .select({ versao: fluxoVersao.versao })
    .from(fluxoVersao)
    .where(eq(fluxoVersao.fluxoId, fluxoId))
    .orderBy(desc(fluxoVersao.versao))
    .limit(1)

  const [nova] = await d
    .insert(fluxoVersao)
    .values({
      fluxoId,
      versao: (ultima?.versao ?? 0) + 1,
      grafo,
      publicadaPor: s.usuarioId,
      ...(publicar ? { publicadaEm: new Date() } : {}),
    })
    .returning({ id: fluxoVersao.id })

  if (publicar) {
    await d
      .update(fluxo)
      .set({ versaoPublicadaId: nova!.id, status: 'publicado', atualizadoEm: new Date() })
      .where(eq(fluxo.id, fluxoId))
  }

  revalidatePath('/fluxos')
  return { ok: true, ...(avisos.length > 0 ? { achados: avisos } : {}) }
}

export async function criarFluxo(clienteId: string, nome: string): Promise<{ ok: boolean; id?: string }> {
  const s = await sessaoAtual()
  if (!s?.permissoes.editarFluxos) return { ok: false }

  const slug =
    nome
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || `fluxo-${Date.now()}`

  const d = db()
  const [c] = await d.select().from(cliente).where(eq(cliente.id, clienteId)).limit(1)
  if (!c) return { ok: false }

  const [f] = await d
    .insert(fluxo)
    .values({ clienteId, nome, slug })
    .returning({ id: fluxo.id })

  // Fluxo novo já nasce com entrada e guarda: são as duas etapas que o motor
  // aplica de qualquer jeito, e vê-las desenhadas evita surpresa.
  await d.insert(fluxoVersao).values({
    fluxoId: f!.id,
    versao: 1,
    grafo: [
      {
        id: 'entrada',
        tipo: 'entrada',
        cfg: {
          url: `https://hooks.avexa.global/v1/${c.slug}/${slug}`,
          metodo: 'POST (JSON)',
          campos: 'nome, telefone, email',
          utm: 'Sim, todas as utm_*',
          extra: '',
          idade: '24 horas',
          dedupe: 'Atualizar e não recontatar',
        },
      },
      { id: 'guarda', tipo: 'guarda', cfg: { janela: '09:00 às 20:00', fds: 'Não' } },
    ],
  })

  revalidatePath('/fluxos')
  return { ok: true, id: f!.id }
}
