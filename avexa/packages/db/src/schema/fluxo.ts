import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { canalEnum, fluxoStatusEnum, idiomaEnum, templateStatusEnum } from './enums.ts'
import { cliente, usuario } from './tenancy.ts'

/** Um fluxo do cliente. Cada um tem a sua própria URL de entrada — é ela que
 *  entregamos para colar na saída do formulário, no CRM ou onde for. */
export const fluxo = pgTable(
  'fluxo',
  {
    id: uuid().primaryKey().defaultRandom(),
    clienteId: uuid()
      .notNull()
      .references(() => cliente.id, { onDelete: 'cascade' }),
    nome: text().notNull(),
    /** Segundo segmento da URL: hooks.avexa.global/v1/<clienteSlug>/<slug> */
    slug: text().notNull(),
    status: fluxoStatusEnum().notNull().default('rascunho'),
    /** Aponta para a versão que recebe leads novos. Execução em curso continua
     *  na versão em que começou. */
    versaoPublicadaId: uuid(),
    criadoEm: timestamp({ withTimezone: true }).notNull().defaultNow(),
    atualizadoEm: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('fluxo_slug_idx').on(t.clienteId, t.slug)],
)

/** Versão imutável do grafo. Publicar cria uma versão nova em vez de sobrescrever:
 *  um lead que está há dois dias numa espera precisa terminar o fluxo que começou. */
export const fluxoVersao = pgTable(
  'fluxo_versao',
  {
    id: uuid().primaryKey().defaultRandom(),
    fluxoId: uuid()
      .notNull()
      .references(() => fluxo.id, { onDelete: 'cascade' }),
    versao: integer().notNull(),
    /** Árvore de etapas (`Etapa[]` de @avexa/core), com ramos `sim`/`nao` e `corpo`. */
    grafo: jsonb().$type<unknown>().notNull(),
    publicadaEm: timestamp({ withTimezone: true }),
    publicadaPor: uuid().references(() => usuario.id, { onDelete: 'set null' }),
    criadoEm: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('fluxo_versao_idx').on(t.fluxoId, t.versao)],
)

/** Template por cliente e canal.
 *
 *  E-mail e SMS são nossos: aprovação interna, status vai direto para `aprovado`.
 *  WhatsApp passa pela Meta — o painel submete via API e acompanha o retorno.
 *  Trocar o valor de uma variável não exige nova aprovação; mudar texto fixo, sim,
 *  e é por isso que `corpo` e `variaveis` são colunas separadas. */
export const template = pgTable(
  'template',
  {
    id: uuid().primaryKey().defaultRandom(),
    clienteId: uuid()
      .notNull()
      .references(() => cliente.id, { onDelete: 'cascade' }),
    canal: canalEnum().notNull(),
    nome: text().notNull(),
    idioma: idiomaEnum().notNull().default('en'),
    assunto: text(),
    /** Texto fixo, com marcadores {{variavel}}. Alterar isto invalida a aprovação. */
    corpo: text().notNull().default(''),
    /** Nomes e valores padrão das variáveis. Alterar isto não invalida nada. */
    variaveis: jsonb().$type<Record<string, string>>().notNull().default({}),
    status: templateStatusEnum().notNull().default('rascunho'),
    /** Rastreio da submissão à Meta (só WhatsApp). */
    metaTemplateId: text(),
    metaStatus: text(),
    metaMotivoRejeicao: text(),
    metaSubmetidoEm: timestamp({ withTimezone: true }),
    /** Hash do `corpo` no momento da aprovação, para detectar edição de texto fixo. */
    hashAprovado: text(),
    arquivado: boolean().notNull().default(false),
    criadoEm: timestamp({ withTimezone: true }).notNull().defaultNow(),
    atualizadoEm: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('template_cliente_canal_idx').on(t.clienteId, t.canal)],
)
