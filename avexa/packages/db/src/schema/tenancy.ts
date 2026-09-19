import {
  boolean,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { canalEnum, clienteStatusEnum, idiomaEnum, numeroStatusEnum, papelEnum } from './enums.ts'

/** Cliente atendido pela Platty. É o tenant: quase tudo pendura aqui.
 *  A exceção deliberada é `supressao`, que é global por pessoa. */
export const cliente = pgTable(
  'cliente',
  {
    id: uuid().primaryKey().defaultRandom(),
    /** Compõe a URL do webhook: hooks.avexa.global/v1/<slug>/<fluxoSlug> */
    slug: text().notNull(),
    nome: text().notNull(),
    setor: text(),
    fusoHorario: text().notNull().default('Australia/Sydney'),
    idiomaPadrao: idiomaEnum().notNull().default('en'),
    status: clienteStatusEnum().notNull().default('ativando'),
    /** Executa fluxos por inteiro e registra tudo, sem disparar nada de verdade.
     *  Permite rodar em espelho antes da virada. */
    dryRun: boolean().notNull().default(true),
    criadoEm: timestamp({ withTimezone: true }).notNull().defaultNow(),
    atualizadoEm: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('cliente_slug_idx').on(t.slug)],
)

/** Canais contratados por cliente. Um nó de canal desligado aqui aparece como
 *  "off" no construtor e não pode ser inserido. */
export const clienteCanal = pgTable(
  'cliente_canal',
  {
    id: uuid().primaryKey().defaultRandom(),
    clienteId: uuid()
      .notNull()
      .references(() => cliente.id, { onDelete: 'cascade' }),
    canal: canalEnum().notNull(),
    ativo: boolean().notNull().default(true),
    /** Ajustes por canal: remetente, número dedicado de voz, id do assistente Vapi. */
    config: jsonb().$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [uniqueIndex('cliente_canal_idx').on(t.clienteId, t.canal)],
)

/** Pool de números. Voz é o único canal com número dedicado por cliente; o mesmo
 *  número atende SMS, para o lead reconhecer a origem. */
export const numero = pgTable(
  'numero',
  {
    id: uuid().primaryKey().defaultRandom(),
    e164: text().notNull(),
    provedor: text().notNull().default('twilio'),
    provedorSid: text(),
    /** Capacidades do número: ['voz','sms'] */
    capacidades: jsonb().$type<string[]>().notNull().default(['voz', 'sms']),
    status: numeroStatusEnum().notNull().default('livre'),
    clienteId: uuid().references(() => cliente.id, { onDelete: 'set null' }),
    /** Id do assistente de voz (Vapi) configurado para este número. */
    assistenteId: text(),
    criadoEm: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('numero_e164_idx').on(t.e164),
    index('numero_cliente_idx').on(t.clienteId),
  ],
)

/** Quem entra no painel. `clienteId` só é preenchido para o papel `cliente`,
 *  que enxerga exclusivamente os próprios leads, em leitura. */
export const usuario = pgTable(
  'usuario',
  {
    id: uuid().primaryKey().defaultRandom(),
    email: text().notNull(),
    nome: text().notNull(),
    papel: papelEnum().notNull(),
    clienteId: uuid().references(() => cliente.id, { onDelete: 'cascade' }),
    idioma: idiomaEnum().notNull().default('pt-BR'),
    ativo: boolean().notNull().default(true),
    ultimoAcessoEm: timestamp({ withTimezone: true }),
    criadoEm: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('usuario_email_idx').on(t.email)],
)

/** Link mágico. Guardamos só o hash do token; o valor em claro vive no e-mail. */
export const tokenAcesso = pgTable(
  'token_acesso',
  {
    id: uuid().primaryKey().defaultRandom(),
    usuarioId: uuid()
      .notNull()
      .references(() => usuario.id, { onDelete: 'cascade' }),
    tokenHash: text().notNull(),
    expiraEm: timestamp({ withTimezone: true }).notNull(),
    usadoEm: timestamp({ withTimezone: true }),
    ip: text(),
    criadoEm: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('token_acesso_hash_idx').on(t.tokenHash)],
)

export const sessao = pgTable(
  'sessao',
  {
    id: uuid().primaryKey().defaultRandom(),
    usuarioId: uuid()
      .notNull()
      .references(() => usuario.id, { onDelete: 'cascade' }),
    tokenHash: text().notNull(),
    expiraEm: timestamp({ withTimezone: true }).notNull(),
    criadoEm: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('sessao_hash_idx').on(t.tokenHash),
    index('sessao_usuario_idx').on(t.usuarioId),
  ],
)
