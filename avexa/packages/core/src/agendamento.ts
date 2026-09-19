import type { Intervalo } from './agenda.ts'

/** Camada de agenda, no mesmo espírito dos adaptadores de canal.
 *
 *  O cliente agenda com a ferramenta dele. A Avexa não impõe calendário, e o
 *  motor não sabe se por trás está Google, Calendly ou o que vier — ele pede uma
 *  reunião e recebe uma de duas respostas.
 *
 *  As duas respostas existem porque os fornecedores são genuinamente diferentes,
 *  e fingir que são iguais quebraria um dos dois:
 *
 *  - **marcado** — nós escolhemos o horário e criamos o compromisso. É o Google
 *    Calendar, onde temos acesso de escrita à agenda do time.
 *  - **link** — entregamos um endereço e quem escolhe é o lead. É o Calendly,
 *    que de propósito não deixa ninguém marcar na agenda de outra pessoa pela
 *    API. A confirmação chega depois, por webhook.
 *
 *  Um fluxo desenhado com "Agendar reunião" funciona nos dois casos; o que muda
 *  é quando a reunião fica de pé, e isso o motor precisa saber. */

export type ProvedorAgenda = 'google_calendar' | 'calendly'

export interface PedidoReuniao {
  titulo: string
  descricao?: string
  duracaoMin: number
  lembreteMin?: number
  /** Para convidar e para identificar quem marcou, quando o link é usado. */
  emailDoLead: string
  nomeDoLead?: string
  fusoDoLead: string
  /** A partir de quando procurar. */
  de: Date
}

export type ResultadoReuniao =
  | {
      tipo: 'marcado'
      inicio: Date
      fim: Date
      /** Agenda ou consultor que ficou com a reunião. */
      responsavel: string
      link?: string
      conferencia?: string
    }
  | {
      tipo: 'link'
      /** Endereço para entregar ao lead. Uso único quando o fornecedor permite. */
      url: string
      /** Alguns fornecedores expiram o link; nulo quando não expira. */
      expiraEm?: Date
    }
  | { tipo: 'falhou'; erro: string; precisaReconectar?: boolean }

export interface AdaptadorAgenda {
  readonly provedor: ProvedorAgenda
  /** `true` quando a reunião fica de pé na hora; `false` quando quem marca é o
   *  lead, e a confirmação chega por webhook depois. */
  readonly marcaDireto: boolean

  oferecer(pedido: PedidoReuniao): Promise<ResultadoReuniao>

  /** Horários ocupados, quando o fornecedor expõe. Usado só por quem marca
   *  direto; um fornecedor de link não precisa implementar. */
  ocupados?(de: Date, ate: Date): Promise<Record<string, Intervalo[]> | null>
}

/** Confirmação de reunião vinda de webhook do fornecedor de agenda. */
export interface ReuniaoConfirmada {
  provedor: ProvedorAgenda
  /** Identificador do compromisso no fornecedor, para casar cancelamento. */
  externoId: string
  emailDoConvidado: string
  nomeDoConvidado?: string
  inicio: Date
  fim?: Date
  cancelada: boolean
  motivoCancelamento?: string
  payload?: Record<string, unknown>
}
