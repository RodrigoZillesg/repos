import type { Canal } from './tipos.ts'

/** Intenção de contato emitida pelo motor.
 *
 *  O motor não sabe o que é Resend nem o que é WhatsApp: ele produz isto e um
 *  adaptador traduz. É o que permite trocar de fornecedor sem reescrever produto e
 *  acrescentar Telegram sem tocar em nenhum fluxo existente. */
export interface IntencaoContato {
  tentativaId: string
  canal: Canal
  destinatario: string
  remetente?: string
  /** Template já resolvido, com as variáveis substituídas. */
  assunto?: string
  texto?: string
  html?: string
  /** Identificador do template no fornecedor, quando ele exige um aprovado. */
  templateExterno?: string
  variaveis?: Record<string, string>
  /** Ajustes específicos do canal: roteiro de voz, tempo de toque, reply-to. */
  opcoes?: Record<string, unknown>
}

export interface ResultadoEnvio {
  ok: boolean
  /** Id do fornecedor, para casar o webhook de retorno com a tentativa. */
  provedorId?: string
  erro?: string
  /** Falha passageira: vale reenfileirar. Falha definitiva: não vale. */
  reenviavel?: boolean
  detalhe?: Record<string, unknown>
}

export type EstadoEntrega =
  | 'pendente'
  | 'enviada'
  | 'entregue'
  | 'lida'
  | 'respondida'
  | 'falhou'
  | 'desconhecida'

/** Todo canal implementa a mesma interface: enviar, receber, status.
 *
 *  Acrescentar Telegram, RCS ou Instagram Direct é escrever mais uma implementação
 *  disto. Nenhum fluxo de cliente precisa ser alterado. */
export interface AdaptadorCanal {
  readonly canal: Canal
  readonly provedor: string

  enviar(intencao: IntencaoContato): Promise<ResultadoEnvio>

  /** Consulta o estado no fornecedor quando o webhook não chegou. */
  status?(provedorId: string): Promise<EstadoEntrega>

  /** Traduz o webhook do fornecedor para eventos do domínio. Recebe o corpo cru e
   *  os cabeçalhos para poder validar a assinatura. */
  interpretarWebhook?(
    corpo: unknown,
    cabecalhos: Record<string, string>,
  ): Promise<EventoRecebido[]> | EventoRecebido[]
}

export interface EventoRecebido {
  provedorId?: string
  canal: Canal
  tipo:
    | 'entregue'
    | 'lida'
    | 'respondida'
    | 'bounce'
    | 'reclamacao'
    | 'optout'
    | 'atendida'
    | 'nao_atendida'
    | 'caixa_postal'
    | 'falha'
  /** Telefone em E.164 ou e-mail, para achar a pessoa quando não há provedorId. */
  identificador?: string
  texto?: string
  payload?: Record<string, unknown>
}

/** Adaptador que registra a intenção e não envia nada.
 *
 *  É o que sustenta o modo dry-run: o fluxo roda por inteiro, cada tentativa fica
 *  gravada, e nenhum lead recebe nada. Permite rodar em espelho antes da virada. */
export function adaptadorSeco(canal: Canal): AdaptadorCanal {
  return {
    canal,
    provedor: 'dry-run',
    async enviar(intencao) {
      return {
        ok: true,
        provedorId: `dry-${intencao.tentativaId}`,
        detalhe: { dryRun: true },
      }
    },
  }
}
