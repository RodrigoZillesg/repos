import { and, eq, isNull } from 'drizzle-orm'
import { criarAdaptador } from '@avexa/adapters'
import type { Canal, EventoRecebido } from '@avexa/core'
import {
  chamada as tChamada,
  evento as tEvento,
  execucao as tExecucao,
  lead as tLead,
  mensagem as tMensagem,
  tentativa as tTentativa,
} from '@avexa/db'
import { agendarAvanco, suprimir } from '@avexa/servicos'
import type { Ambiente } from './contexto.ts'

/** Processa o que voltou do fornecedor.
 *
 *  É por aqui que "parada na primeira resposta" e "opt-out vale em tudo"
 *  acontecem de verdade: as regras sabem consultar esses fatos, mas alguém
 *  precisa gravá-los. */
export async function processarEvento(
  amb: Ambiente,
  canal: Canal,
  corpo: unknown,
  cabecalhos: Record<string, string>,
): Promise<number> {
  const adaptador = criarAdaptador(canal, amb.adaptadores)
  if (!adaptador?.interpretarWebhook) return 0

  const eventos = await adaptador.interpretarWebhook(corpo, cabecalhos)
  for (const e of eventos) {
    await aplicar(amb, e)
  }
  return eventos.length
}

async function aplicar(amb: Ambiente, e: EventoRecebido): Promise<void> {
  const { db } = amb

  // Casa o evento com a tentativa pelo id do fornecedor. Quando o fornecedor não
  // devolve id — mensagem recebida, por exemplo — casa pelo identificador da
  // pessoa, pegando a tentativa aberta mais recente naquele canal.
  const alvo = e.provedorId
    ? (
        await db
          .select()
          .from(tTentativa)
          .where(eq(tTentativa.provedorId, e.provedorId))
          .limit(1)
      )[0]
    : e.identificador
      ? (
          await db
            .select()
            .from(tTentativa)
            .where(
              and(
                eq(tTentativa.destinatario, e.identificador),
                eq(tTentativa.canal, e.canal),
                isNull(tTentativa.respondidaEm),
              ),
            )
            .orderBy(tTentativa.criadoEm)
            .limit(1)
        )[0]
      : undefined

  await db.insert(tEvento).values({
    ...(alvo ? { tentativaId: alvo.id, pessoaId: alvo.pessoaId } : {}),
    canal: e.canal,
    tipo: e.tipo,
    ...(e.provedorId ? { provedorId: e.provedorId } : {}),
    payload: (e.payload ?? {}) as Record<string, unknown>,
  })

  // Opt-out: grava na supressão global, pelos dois identificadores da pessoa.
  if (e.tipo === 'optout') {
    const ld = alvo
      ? (await db.select().from(tLead).where(eq(tLead.id, alvo.leadId)).limit(1))[0]
      : undefined
    await suprimir(
      db,
      ld
        ? { telefone: ld.telefone, email: ld.email }
        : e.canal === 'email'
          ? { email: e.identificador ?? null }
          : { telefone: e.identificador ?? null },
      {
        motivo: 'pedido do lead',
        canal: e.canal,
        ...(alvo ? { clienteId: alvo.clienteId, pessoaId: alvo.pessoaId } : {}),
      },
    )
  }

  // Bounce e reclamação de e-mail também suprimem: continuar enviando para um
  // endereço que rejeita queima a reputação do domínio único da Avexa.
  if ((e.tipo === 'bounce' || e.tipo === 'reclamacao') && e.identificador) {
    await suprimir(db, { email: e.identificador }, { motivo: `e-mail ${e.tipo}`, canal: 'email' })
  }

  if (!alvo) return

  const respondeu = e.tipo === 'respondida' || e.tipo === 'optout' || e.tipo === 'atendida'
  const novoEstado =
    e.tipo === 'entregue'
      ? 'entregue'
      : e.tipo === 'lida'
        ? 'lida'
        : respondeu
          ? 'respondida'
          : e.tipo === 'falha'
            ? 'falhou'
            : alvo.estado

  await db
    .update(tTentativa)
    .set({
      estado: novoEstado,
      ...(respondeu ? { respondidaEm: amb.agora() } : {}),
      resultado: { ...(alvo.resultado as object), ...(e.payload ?? {}), texto: e.texto ?? null },
    })
    .where(eq(tTentativa.id, alvo.id))

  if (e.texto) {
    await db.insert(tMensagem).values({
      tentativaId: alvo.id,
      pessoaId: alvo.pessoaId,
      clienteId: alvo.clienteId,
      canal: e.canal,
      entrada: true,
      texto: e.texto,
    })
  }

  if (e.canal === 'ligacao') {
    const p = (e.payload ?? {}) as Record<string, unknown>
    await db.insert(tChamada).values({
      tentativaId: alvo.id,
      ...(e.provedorId ? { provedorCallId: e.provedorId } : {}),
      atendida: e.tipo === 'atendida' || e.tipo === 'optout',
      caixaPostal: e.tipo === 'caixa_postal',
      duracaoSegundos: Number(p.duracaoSegundos ?? 0),
      ...(typeof p.gravacaoUrl === 'string' ? { gravacaoUrl: p.gravacaoUrl } : {}),
      ...(e.texto ? { transcricao: e.texto } : {}),
      avisoGravacaoEmitido: true,
      encerradaEm: amb.agora(),
    })
  }

  // Uma resposta acorda a execução na hora: a espera em curso precisa ser
  // cancelada agora, não quando vencer.
  if (respondeu) {
    const [ex] = await db
      .select({ id: tExecucao.id, estado: tExecucao.estado })
      .from(tExecucao)
      .where(eq(tExecucao.id, alvo.execucaoId))
      .limit(1)
    if (ex && (ex.estado === 'aguardando' || ex.estado === 'executando')) {
      await agendarAvanco(ex.id)
    }
  }
}
