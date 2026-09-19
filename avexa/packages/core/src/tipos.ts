/** Canais de contato. Acrescentar um canal é acrescentar um adaptador — nenhum
 *  fluxo de cliente precisa ser alterado. */
export type Canal = 'ligacao' | 'whatsapp' | 'sms' | 'email' | 'telegram'

export type TipoEtapa =
  | 'entrada'
  | 'guarda'
  | 'ligacao'
  | 'whatsapp'
  | 'sms'
  | 'email'
  | 'espera'
  | 'condicao'
  | 'loop'
  | 'subfluxo'
  | 'webhookout'
  | 'score'
  | 'agendar'
  | 'marcar'
  | 'entregar'
  | 'encerrar'

/** Uma etapa do fluxo. `sim`/`nao` são os ramos de uma condição e `corpo` é o
 *  bloco interno de uma repetição — é isso que torna o grafo uma árvore, não uma
 *  lista. O motor caminha essa árvore com uma pilha de índices. */
export interface Etapa {
  id: string
  tipo: TipoEtapa
  cfg: Record<string, string>
  sim?: Etapa[]
  nao?: Etapa[]
  corpo?: Etapa[]
}

export type Grafo = Etapa[]

/** Onde a execução parou dentro da árvore. Cada nível é o índice na lista e, para
 *  etapas com ramo, qual ramo foi tomado. */
export type Posicao = Array<{ indice: number; ramo?: 'sim' | 'nao' | 'corpo'; volta?: number }>

/** Limites que o fluxo nunca pode ultrapassar. Vêm de `config_global`. */
export interface LimitesMotor {
  tetoTentativas: number
  janelaInicioMin: number
  janelaFimMin: number
  contatarSabado: boolean
  contatarDomingo: boolean
  intervaloMinimoMin: number
  profundidadeMaxSubfluxo: number
}

export const LIMITES_PADRAO: LimitesMotor = {
  tetoTentativas: 5,
  janelaInicioMin: 9 * 60,
  janelaFimMin: 20 * 60,
  contatarSabado: false,
  contatarDomingo: false,
  intervaloMinimoMin: 60,
  profundidadeMaxSubfluxo: 3,
}

/** Por que uma tentativa não saiu. Vira a coluna `motivo` em `tentativa` e é o que
 *  o monitor mostra quando um lead não foi contatado. */
export type MotivoBloqueio =
  | 'suprimido'
  | 'fora_da_janela'
  | 'teto_de_tentativas'
  | 'intervalo_minimo'
  | 'ja_respondeu'
  | 'canal_desligado'
  | 'template_nao_aprovado'
  | 'sem_destinatario'
  | 'sem_link_agendamento'
