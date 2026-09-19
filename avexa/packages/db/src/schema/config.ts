import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'
import { integracaoTipoEnum } from './enums.ts'
import { cliente, usuario } from './tenancy.ts'

/** Limites de segurança do motor, editáveis pelo admin no painel.
 *
 *  Um fluxo pode pedir menos que estes valores, nunca mais: são teto, não padrão.
 *  Linha única, `id` fixo em 1. */
export const configGlobal = pgTable('config_global', {
  id: integer().primaryKey().default(1),
  /** Teto absoluto de tentativas por lead por fluxo. */
  tetoTentativas: integer().notNull().default(5),
  /** Janela de contato no fuso do lead, em minutos desde a meia-noite. */
  janelaInicioMin: integer().notNull().default(9 * 60),
  janelaFimMin: integer().notNull().default(20 * 60),
  contatarSabado: boolean().notNull().default(false),
  contatarDomingo: boolean().notNull().default(false),
  /** Intervalo mínimo entre dois contatos com a mesma pessoa, em minutos.
   *  Sustenta a regra de um canal por janela. */
  intervaloMinimoMin: integer().notNull().default(60),
  /** Profundidade máxima de cadeia de subfluxos. */
  profundidadeMaxSubfluxo: integer().notNull().default(3),
  /** Retenção, em dias. Zero desliga o expurgo. */
  retencaoLeadDias: integer().notNull().default(0),
  retencaoGravacaoDias: integer().notNull().default(0),
  atualizadoEm: timestamp({ withTimezone: true }).notNull().defaultNow(),
  atualizadoPor: uuid().references(() => usuario.id, { onDelete: 'set null' }),
})

/** Destino de entrega configurado por cliente: HubSpot, Google Calendar, Sheets,
 *  webhook ou e-mail do time. Credenciais ficam cifradas em `segredo`. */
export const integracao = pgTable(
  'integracao',
  {
    id: uuid().primaryKey().defaultRandom(),
    clienteId: uuid()
      .notNull()
      .references(() => cliente.id, { onDelete: 'cascade' }),
    tipo: integracaoTipoEnum().notNull(),
    nome: text().notNull(),
    config: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    /** Cifrado em repouso com a chave da aplicação. Nunca sai pela API. */
    segredo: text(),
    ativo: boolean().notNull().default(true),
    criadoEm: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('integracao_cliente_idx').on(t.clienteId, t.tipo)],
)

/** Trilha de auditoria: quem mexeu em quê. Papel designer e copywriter não veem
 *  dado de lead, então a trilha é o que prova que a separação está sendo cumprida. */
export const auditoria = pgTable(
  'auditoria',
  {
    id: uuid().primaryKey().defaultRandom(),
    usuarioId: uuid().references(() => usuario.id, { onDelete: 'set null' }),
    clienteId: uuid().references(() => cliente.id, { onDelete: 'set null' }),
    acao: text().notNull(),
    entidade: text().notNull(),
    entidadeId: text(),
    detalhe: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    ip: text(),
    criadoEm: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('auditoria_entidade_idx').on(t.entidade, t.entidadeId, t.criadoEm)],
)
