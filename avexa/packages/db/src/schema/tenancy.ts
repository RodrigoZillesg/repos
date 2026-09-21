import { sql } from 'drizzle-orm'
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
import {
  canalEnum,
  clienteStatusEnum,
  idiomaEnum,
  numeroStatusEnum,
  papelEnum,
  provedorAgendaEnum,
} from './enums.ts'

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
    /** País do cliente, em ISO-3166 alfa-2. Decide como um telefone sem DDI é
     *  normalizado. Fica gravado em vez de inferido do fuso a cada lead: um
     *  cliente em America/Los_Angeles tratado como australiano perderia o
     *  telefone de todo lead, e com ele a ligação e o SMS. */
    pais: text().notNull().default('AU'),
    idiomaPadrao: idiomaEnum().notNull().default('en'),
    status: clienteStatusEnum().notNull().default('ativando'),
    /** Ferramenta de agenda preferida quando o cliente conectou mais de uma.
     *  Nulo deixa a escolha para o serviço. */
    provedorAgenda: provedorAgendaEnum(),
    criadoEm: timestamp({ withTimezone: true }).notNull().defaultNow(),
    atualizadoEm: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('cliente_slug_idx').on(t.slug)],
)

/** Frente de trabalho dentro de um cliente.
 *
 *  Um cliente contrata mais de uma coisa ao mesmo tempo — duas escolas da mesma
 *  rede, duas campanhas, dois idiomas — e cada frente tem o próprio número de
 *  telefone. Sem isto, todo número de um cliente se chama igual, e a lista no
 *  console do Twilio vira uma coluna de números idênticos de nome, que é
 *  exatamente o problema que já existe na conta antiga.
 *
 *  É deliberadamente magro: nome e dono. Não é um segundo tenant — fluxo, lead
 *  e execução continuam pendurados no cliente. O que o projeto faz hoje é dar
 *  nome próprio a um número. */
export const projeto = pgTable(
  'projeto',
  {
    id: uuid().primaryKey().defaultRandom(),
    clienteId: uuid()
      .notNull()
      .references(() => cliente.id, { onDelete: 'cascade' }),
    nome: text().notNull(),
    /** Terceiro segmento da URL de webhook:
     *  hooks.avexa.global/v1/<clienteSlug>/<projetoSlug>/<fluxoSlug> */
    slug: text().notNull(),
    /** Executa fluxos por inteiro e registra tudo, sem disparar nada de verdade.
     *  Fica no projeto e não no cliente para dar virar a torneira de uma frente
     *  por vez: a escola nova entra em seco enquanto a antiga já contata. */
    dryRun: boolean().notNull().default(true),
    /** Projeto encerrado some das listas de escolha sem sumir dos números que
     *  já carregam o nome dele. Apagar quebraria o histórico. */
    ativo: boolean().notNull().default(true),
    criadoEm: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Sem distinguir maiúscula: "Path A" e "path a" são o mesmo projeto, e dois
    // deles dariam dois apelidos iguais no Twilio para números diferentes.
    uniqueIndex('projeto_nome_idx').on(t.clienteId, sql`lower(${t.nome})`),
    uniqueIndex('projeto_slug_idx').on(t.clienteId, t.slug),
    index('projeto_cliente_idx').on(t.clienteId),
  ],
)

/** Canais contratados por PROJETO. Um nó de canal desligado aqui aparece como
 *  "off" no construtor e não pode ser inserido.
 *
 *  Por projeto e não por cliente porque é o projeto que tem número próprio: uma
 *  frente pode usar SMS e a outra não, e as duas falam de telefones diferentes.
 *  Com isso preso ao cliente, ligar SMS para uma escola ligava para as duas. */
export const projetoCanal = pgTable(
  'projeto_canal',
  {
    id: uuid().primaryKey().defaultRandom(),
    projetoId: uuid()
      .notNull()
      .references(() => projeto.id, { onDelete: 'cascade' }),
    canal: canalEnum().notNull(),
    ativo: boolean().notNull().default(true),
    /** Ajustes por canal: remetente, número dedicado de voz, id do assistente Vapi. */
    config: jsonb().$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [uniqueIndex('projeto_canal_idx').on(t.projetoId, t.canal)],
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
    /** Frente que fala por este número, e o único dono dele.
     *
     *  O cliente sai por aqui (projeto.clienteId) em vez de ter coluna própria:
     *  duas colunas de dono divergem, e a divergência silenciosa seria um
     *  número falando por um cliente e nomeado por outro. Nulo enquanto o
     *  número está no pool; ao apagar o projeto o número continua nosso. */
    projetoId: uuid().references(() => projeto.id, { onDelete: 'set null' }),
    /** Id do assistente de voz (Vapi) configurado para este número. */
    assistenteId: text(),
    criadoEm: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('numero_e164_idx').on(t.e164),
    index('numero_projeto_idx').on(t.projetoId),
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
