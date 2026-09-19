import { pgEnum } from 'drizzle-orm/pg-core'

/** Canais de contato. `telegram` existe no enum antes do adaptador: acrescentar um
 *  canal novo não deve exigir migração de banco. */
export const canalEnum = pgEnum('canal', ['ligacao', 'whatsapp', 'sms', 'email', 'telegram'])

/** Papéis do painel. `cliente` é o acesso somente-leitura do cliente final. */
export const papelEnum = pgEnum('papel', ['admin', 'operacao', 'designer', 'copy', 'cliente'])

export const clienteStatusEnum = pgEnum('cliente_status', [
  'ativando',
  'ativo',
  'pausado',
  'encerrado',
])

export const fluxoStatusEnum = pgEnum('fluxo_status', ['rascunho', 'publicado', 'pausado'])

/** Status de aprovação de template. Só `aprovado` libera o nó que o referencia. */
export const templateStatusEnum = pgEnum('template_status', [
  'rascunho',
  'pendente',
  'aprovado',
  'rejeitado',
])

export const execucaoEstadoEnum = pgEnum('execucao_estado', [
  'executando',
  'aguardando',
  'concluida',
  'cancelada',
  'falhou',
])

/** Ciclo de vida de uma tentativa de contato — a unidade de auditoria do sistema. */
export const tentativaEstadoEnum = pgEnum('tentativa_estado', [
  'agendada',
  'suprimida',
  'enviada',
  'entregue',
  'lida',
  'respondida',
  'falhou',
  'cancelada',
])

export const eventoTipoEnum = pgEnum('evento_tipo', [
  'entregue',
  'lida',
  'respondida',
  'bounce',
  'reclamacao',
  'optout',
  'atendida',
  'nao_atendida',
  'caixa_postal',
  'falha',
])

export const supressaoTipoEnum = pgEnum('supressao_tipo', ['telefone', 'email'])

export const integracaoTipoEnum = pgEnum('integracao_tipo', [
  'hubspot',
  'google_calendar',
  'google_sheets',
  'webhook',
  'email_time',
])

export const numeroStatusEnum = pgEnum('numero_status', ['livre', 'reservado', 'atribuido', 'inativo'])

export const idiomaEnum = pgEnum('idioma', ['pt-BR', 'en'])
