import { adaptadoresDoAmbiente, type ConfigAdaptadores } from '@avexa/adapters'
import { modeloDoAmbiente } from '@avexa/ia'
import type { ModeloIA } from '@avexa/ia'
import { db, type Db } from '@avexa/db'

/** Dependências do worker, montadas uma vez e passadas adiante.
 *
 *  Tudo que fala com o mundo entra por aqui, para que o executor possa ser
 *  exercitado com adaptadores falsos sem tocar em fornecedor nenhum. */
export interface Ambiente {
  db: Db
  adaptadores: ConfigAdaptadores
  ia: ModeloIA | null
  agora: () => Date
}

export function ambientePadrao(): Ambiente {
  return {
    db: db(),
    adaptadores: adaptadoresDoAmbiente(),
    ia: modeloDoAmbiente(),
    agora: () => new Date(),
  }
}
