import { fila, FILAS, encerrarFila, type TrabalhoAvancar, type TrabalhoEvento } from '@avexa/servicos'
import type { Canal } from '@avexa/core'
import { ambientePadrao } from './contexto.ts'
import { avancarExecucao } from './executor.ts'
import { processarEvento } from './eventos.ts'

/** Processo do motor de fluxo.
 *
 *  Separado do painel de propósito: uma espera de três dias e um reenvio com
 *  recuo exponencial precisam de um processo que viva, e o painel não vive entre
 *  requisições. */

const CONCORRENCIA = Number(process.env.WORKER_CONCORRENCIA ?? 5)

async function principal(): Promise<void> {
  const amb = ambientePadrao()
  const b = await fila()

  const canaisConfigurados = Object.keys(amb.adaptadores)
  console.log(
    `[avexa] worker no ar · canais: ${canaisConfigurados.join(', ') || 'nenhum'} · IA: ${amb.ia?.modelo ?? 'nenhuma'}`,
  )
  if (canaisConfigurados.length === 0) {
    console.warn('[avexa] nenhum canal configurado: toda tentativa será pulada por canal indisponível')
  }

  await b.work<TrabalhoAvancar>(
    FILAS.avancar,
    { batchSize: CONCORRENCIA },
    async (trabalhos) => {
      for (const t of trabalhos) {
        try {
          await avancarExecucao(amb, t.data.execucaoId)
        } catch (e) {
          // Deixa o pg-boss reenfileirar com recuo: falha de rede no meio de um
          // passo não pode perder o lead.
          console.error(`[avexa] falha ao avançar ${t.data.execucaoId}:`, e)
          throw e
        }
      }
    },
  )

  await b.work<TrabalhoEvento>(FILAS.evento, { batchSize: CONCORRENCIA }, async (trabalhos) => {
    for (const t of trabalhos) {
      await processarEvento(amb, t.data.canal as Canal, t.data.corpo, t.data.cabecalhos)
    }
  })

  const encerrar = async (sinal: string) => {
    console.log(`[avexa] ${sinal}: encerrando com calma`)
    await encerrarFila()
    process.exit(0)
  }
  process.on('SIGTERM', () => void encerrar('SIGTERM'))
  process.on('SIGINT', () => void encerrar('SIGINT'))
}

principal().catch((e) => {
  console.error('[avexa] worker não subiu:', e)
  process.exit(1)
})
