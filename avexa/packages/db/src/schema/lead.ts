import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { canalEnum, supressaoTipoEnum } from './enums.ts'
import { cliente } from './tenancy.ts'
import { fluxo } from './fluxo.ts'

/** Identidade global de uma pessoa, acima de qualquer cliente.
 *
 *  Existe para sustentar a regra mais forte do produto: a supressão vale para a
 *  pessoa, em todo canal e em todo cliente. Dois leads de clientes diferentes com
 *  o mesmo telefone são a mesma pessoa aqui. */
export const pessoa = pgTable(
  'pessoa',
  {
    id: uuid().primaryKey().defaultRandom(),
    /** E.164 normalizado. */
    telefone: text(),
    /** Minúsculas, sem espaço. */
    email: text(),
    criadoEm: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('pessoa_telefone_idx').on(t.telefone),
    uniqueIndex('pessoa_email_idx').on(t.email),
  ],
)

/** Lista de supressão. **Global de propósito**: sem coluna de cliente no critério
 *  de busca.
 *
 *  Um opt-out vindo por qualquer canal grava duas linhas quando o lead tem telefone
 *  e e-mail — uma por identificador — e ambas bloqueiam todos os canais, em todos
 *  os clientes, para sempre. `clienteOrigemId` é só procedência, nunca filtro. */
export const supressao = pgTable(
  'supressao',
  {
    id: uuid().primaryKey().defaultRandom(),
    tipo: supressaoTipoEnum().notNull(),
    /** Telefone em E.164 ou e-mail em minúsculas. */
    valor: text().notNull(),
    pessoaId: uuid().references(() => pessoa.id, { onDelete: 'set null' }),
    motivo: text().notNull(),
    canalOrigem: canalEnum(),
    clienteOrigemId: uuid().references(() => cliente.id, { onDelete: 'set null' }),
    criadoEm: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('supressao_valor_idx').on(t.tipo, t.valor)],
)

/** Lead recebido por um webhook de entrada.
 *
 *  `dados` guarda o corpo cru da requisição e `campos` a versão normalizada, para
 *  que campo personalizado que ninguém previu continue disponível nas condições e
 *  nos textos sem exigir migração. */
export const lead = pgTable(
  'lead',
  {
    id: uuid().primaryKey().defaultRandom(),
    clienteId: uuid()
      .notNull()
      .references(() => cliente.id, { onDelete: 'cascade' }),
    fluxoId: uuid()
      .notNull()
      .references(() => fluxo.id, { onDelete: 'cascade' }),
    pessoaId: uuid()
      .notNull()
      .references(() => pessoa.id, { onDelete: 'restrict' }),
    nome: text(),
    telefone: text(),
    email: text(),
    /** Fuso resolvido a partir do DDI/estado do lead; decide a janela de contato. */
    fusoHorario: text(),
    idioma: text(),
    /** Corpo cru da requisição, como chegou. */
    dados: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    /** Campos normalizados e personalizados, disponíveis em condições e templates. */
    campos: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    utm: jsonb().$type<Record<string, string>>().notNull().default({}),
    /** Chave de deduplicação: cliente + fluxo + telefone/e-mail. */
    dedupeKey: text().notNull(),
    score: integer(),
    scoreMotivo: text(),
    resumo: text(),
    etiquetas: jsonb().$type<string[]>().notNull().default([]),
    criadoEm: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('lead_cliente_idx').on(t.clienteId, t.criadoEm),
    index('lead_pessoa_idx').on(t.pessoaId),
    index('lead_dedupe_idx').on(t.dedupeKey),
  ],
)
