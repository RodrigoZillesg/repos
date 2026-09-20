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
  /** Padrões do agente de voz para cliente novo.
   *
   *  Ficam aqui, e não fixos no código, porque provedor aposenta modelo sem
   *  avisar — o gemini-2.5-flash morreu embaixo da gente hoje. Cada cliente
   *  nasce com estes valores e pode divergir depois; mudar aqui não mexe em
   *  quem já existe, de propósito: ninguém quer que um ajuste de padrão
   *  reescreva o agente de um cliente em produção. */
  vozModeloProvedor: text().notNull().default('openai'),
  vozModelo: text().notNull().default('gpt-5.6-terra'),
  vozProvedorVoz: text().notNull().default('11labs'),
  vozVozId: text().notNull().default('sarah'),
  vozModeloVoz: text().notNull().default('eleven_multilingual_v2'),
  vozTranscritor: text().notNull().default('deepgram'),
  vozModeloTranscritor: text().notNull().default('nova-3'),
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

/** O agente de voz de um cliente na Vapi.
 *
 *  Cada cliente tem o seu, criado a partir do esqueleto da Avexa e livre para
 *  divergir — é assim que a conta já opera hoje (TALOGY Path A e B são cópias
 *  que seguiram caminhos diferentes), e é o que permite ajustar um cliente sem
 *  arriscar os outros.
 *
 *  Guardamos a configuração AQUI e espelhamos na Vapi. O inverso — tratar a
 *  Vapi como fonte da verdade — deixaria o painel exibindo o que acha que
 *  configurou em vez do que está no ar, e tornaria impossível saber quem mudou
 *  o quê. */
export const agenteVoz = pgTable(
  'agente_voz',
  {
    id: uuid().primaryKey().defaultRandom(),
    clienteId: uuid()
      .notNull()
      .references(() => cliente.id, { onDelete: 'cascade' }),
    /** Id do assistente na Vapi. Nulo enquanto ainda não foi publicado lá. */
    vapiAssistantId: text(),
    nome: text().notNull(),
    /** Idioma da conversa. Decide o transcritor e a voz; hoje a conta resolve
     *  isso duplicando agente, e aqui vira campo. */
    idioma: text().notNull().default('en'),

    /** Cérebro. Começa no padrão global e pode divergir por cliente. */
    modeloProvedor: text().notNull(),
    modelo: text().notNull(),
    /** O prompt de sistema inteiro. É o que mais muda e o que mais importa. */
    prompt: text().notNull(),
    /** Primeira fala. Sai da mesma fonte do prompt: no agente que inspecionamos
     *  os dois divergiam, e um deles se dizia obrigatório e imutável. */
    primeiraMensagem: text().notNull(),
    mensagemEncerramento: text().notNull().default('Have a great day!'),
    mensagemCaixaPostal: text(),

    provedorVoz: text().notNull(),
    vozId: text().notNull(),
    modeloVoz: text(),
    transcritor: text().notNull(),
    modeloTranscritor: text(),

    /** Ajustes finos que não merecem coluna própria: estabilidade da voz,
     *  som de fundo, planos de silêncio. */
    ajustes: jsonb().$type<Record<string, unknown>>().notNull().default({}),

    /** Quando a configuração daqui foi espelhada na Vapi. Nulo ou mais antigo
     *  que `atualizadoEm` significa que há mudança não publicada. */
    publicadoEm: timestamp({ withTimezone: true }),
    atualizadoEm: timestamp({ withTimezone: true }).notNull().defaultNow(),
    atualizadoPor: uuid().references(() => usuario.id, { onDelete: 'set null' }),
    criadoEm: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('agente_voz_cliente_idx').on(t.clienteId),
    index('agente_voz_vapi_idx').on(t.vapiAssistantId),
  ],
)
