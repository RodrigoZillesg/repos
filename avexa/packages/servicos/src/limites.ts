import { eq } from 'drizzle-orm'
import { configGlobal, type Db } from '@avexa/db'
import { LIMITES_PADRAO, type LimitesMotor } from '@avexa/core'

/** Limites de segurança do motor, da linha única de `config_global`.
 *
 *  Se a linha não existir ainda, vale o conservador: é melhor um fluxo contatar
 *  de menos por configuração faltando do que de mais. */
export async function carregarLimites(db: Db): Promise<LimitesMotor> {
  const [linha] = await db.select().from(configGlobal).where(eq(configGlobal.id, 1)).limit(1)
  if (!linha) return LIMITES_PADRAO

  return {
    tetoTentativas: linha.tetoTentativas,
    janelaInicioMin: linha.janelaInicioMin,
    janelaFimMin: linha.janelaFimMin,
    contatarSabado: linha.contatarSabado,
    contatarDomingo: linha.contatarDomingo,
    intervaloMinimoMin: linha.intervaloMinimoMin,
    profundidadeMaxSubfluxo: linha.profundidadeMaxSubfluxo,
  }
}
