import { and, eq, inArray, isNotNull, lt, or, sql } from 'drizzle-orm'
import { chamada, configGlobal, execucao, lead, pessoa, type Db } from '@avexa/db'

/** Expurgo por retenção.
 *
 *  As duas colunas de retenção existiam no banco há tempos sem ninguém lê-las —
 *  ou seja, a política era uma promessa que o produto não cumpria. Isto aqui é o
 *  que a cumpre.
 *
 *  Duas regras que não são negociáveis:
 *
 *  1. **A supressão sobrevive ao expurgo.** Quem pediu para parar continua
 *     bloqueado depois que o lead dele for apagado. A tabela `supressao` guarda
 *     o telefone e o e-mail em si, não uma referência à pessoa, justamente para
 *     isso: apagar o lead não pode virar autorização para contatar de novo.
 *  2. **Lead em andamento não é apagado.** Apagar no meio do percurso mataria a
 *     execução por cascata e o lead sumiria entre um contato e o seguinte. Ele
 *     espera o fluxo terminar e cai no expurgo seguinte.
 *
 *  Retenção zero — o padrão — significa guardar para sempre e não apagar nada. */

export interface RelatorioExpurgo {
  retencaoLeadDias: number
  retencaoGravacaoDias: number
  leadsApagados: number
  /** Velhos o bastante, mas ainda no meio do fluxo. Ficam para a próxima. */
  leadsEmAndamento: number
  pessoasApagadas: number
  gravacoesLimpas: number
}

/** Quantos leads o expurgo pode processar por vez. Um cliente que acumulou
 *  meio milhão de leads não pode travar o banco numa transação só. */
const LOTE = 500

export async function expurgar(db: Db, agora: Date = new Date()): Promise<RelatorioExpurgo> {
  const [cfg] = await db.select().from(configGlobal).where(eq(configGlobal.id, 1)).limit(1)
  const retencaoLeadDias = cfg?.retencaoLeadDias ?? 0
  const retencaoGravacaoDias = cfg?.retencaoGravacaoDias ?? 0

  const relatorio: RelatorioExpurgo = {
    retencaoLeadDias,
    retencaoGravacaoDias,
    leadsApagados: 0,
    leadsEmAndamento: 0,
    pessoasApagadas: 0,
    gravacoesLimpas: 0,
  }

  if (retencaoLeadDias > 0) {
    const corte = new Date(agora.getTime() - retencaoLeadDias * 86_400_000)

    const velhos = await db
      .select({ id: lead.id })
      .from(lead)
      .where(lt(lead.criadoEm, corte))
      .limit(LOTE * 20)

    if (velhos.length > 0) {
      const ids = velhos.map((l) => l.id)
      const emAndamento = await db
        .select({ leadId: execucao.leadId })
        .from(execucao)
        .where(
          and(
            inArray(execucao.leadId, ids),
            inArray(execucao.estado, ['executando', 'aguardando']),
          ),
        )
      const protegidos = new Set(emAndamento.map((e) => e.leadId))
      relatorio.leadsEmAndamento = protegidos.size

      const apagar = ids.filter((id) => !protegidos.has(id))
      for (let i = 0; i < apagar.length; i += LOTE) {
        const lote = apagar.slice(i, i + LOTE)
        const r = await db.delete(lead).where(inArray(lead.id, lote)).returning({ id: lead.id })
        relatorio.leadsApagados += r.length
      }
    }

    // Pessoa que não sustenta mais nenhum lead nem nenhuma tentativa. O corte de
    // data também vale aqui: pessoa recém-criada pela ingestão pode estar a
    // milissegundos de receber o primeiro lead.
    const orfas = (await db.execute(sql`
      delete from pessoa p
      where p.criado_em < ${corte.toISOString()}::timestamptz
        and not exists (select 1 from lead l where l.pessoa_id = p.id)
        and not exists (select 1 from tentativa t where t.pessoa_id = p.id)
      returning p.id
    `)) as unknown as Array<{ id: string }>
    relatorio.pessoasApagadas = orfas.length
  }

  if (retencaoGravacaoDias > 0) {
    const corte = new Date(agora.getTime() - retencaoGravacaoDias * 86_400_000)
    // A linha da chamada fica: duração, se atendeu e se o aviso de gravação foi
    // emitido são o registro de que a ligação aconteceu do jeito certo. O que
    // sai é o conteúdo — áudio e transcrição.
    const r = await db
      .update(chamada)
      .set({ gravacaoUrl: null, transcricao: null })
      .where(
        and(
          lt(chamada.criadoEm, corte),
          or(isNotNull(chamada.gravacaoUrl), isNotNull(chamada.transcricao)),
        ),
      )
      .returning({ id: chamada.id })
    relatorio.gravacoesLimpas = r.length
  }

  return relatorio
}

export function resumoDoExpurgo(r: RelatorioExpurgo): string {
  if (r.retencaoLeadDias === 0 && r.retencaoGravacaoDias === 0) {
    return 'retenção desligada: nada a expurgar'
  }
  const partes = [
    `${r.leadsApagados} lead(s) apagados`,
    `${r.pessoasApagadas} pessoa(s) sem lead removidas`,
    `${r.gravacoesLimpas} gravação(ões) limpas`,
  ]
  if (r.leadsEmAndamento > 0) {
    partes.push(`${r.leadsEmAndamento} preservados por ainda estarem no fluxo`)
  }
  return partes.join(' · ')
}
