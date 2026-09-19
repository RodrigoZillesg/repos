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
import { canalEnum, eventoTipoEnum, execucaoEstadoEnum, tentativaEstadoEnum } from './enums.ts'
import { cliente } from './tenancy.ts'
import { fluxo, fluxoVersao } from './fluxo.ts'
import { lead, pessoa } from './lead.ts'

/** Uma passagem de um lead por um fluxo.
 *
 *  `contexto` acumula o que o fluxo aprendeu (respostas, score, etiquetas) e é o
 *  que o avaliador de condições enxerga. `posicao` é a pilha de índices que marca
 *  onde a execução parou dentro da árvore, inclusive dentro de ramo e de corpo de
 *  repetição — é o que permite retomar depois de uma espera de três dias. */
export const execucao = pgTable(
  'execucao',
  {
    id: uuid().primaryKey().defaultRandom(),
    leadId: uuid()
      .notNull()
      .references(() => lead.id, { onDelete: 'cascade' }),
    clienteId: uuid()
      .notNull()
      .references(() => cliente.id, { onDelete: 'cascade' }),
    fluxoId: uuid()
      .notNull()
      .references(() => fluxo.id, { onDelete: 'cascade' }),
    /** Versão congelada em que esta execução roda até o fim. */
    fluxoVersaoId: uuid()
      .notNull()
      .references(() => fluxoVersao.id, { onDelete: 'restrict' }),
    estado: execucaoEstadoEnum().notNull().default('executando'),
    posicao: jsonb().$type<unknown>().notNull().default([]),
    contexto: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    tentativasFeitas: integer().notNull().default(0),
    /** Profundidade de chamada de subfluxo, para cortar cadeia que vira laço. */
    profundidade: integer().notNull().default(0),
    /** Cadeia de fluxos já visitados nesta corrente de subfluxos. */
    cadeia: jsonb().$type<string[]>().notNull().default([]),
    execucaoPaiId: uuid(),
    /** Herdado do cliente no momento em que a execução nasce. */
    dryRun: boolean().notNull().default(false),
    retomarEm: timestamp({ withTimezone: true }),
    motivoEncerramento: text(),
    iniciadoEm: timestamp({ withTimezone: true }).notNull().defaultNow(),
    encerradoEm: timestamp({ withTimezone: true }),
  },
  (t) => [
    index('execucao_lead_idx').on(t.leadId),
    index('execucao_retomar_idx').on(t.estado, t.retomarEm),
    index('execucao_cliente_idx').on(t.clienteId, t.iniciadoEm),
  ],
)

/** Cada contato tentado é um registro: para quem, de qual cliente, em qual fluxo,
 *  por qual canal, em que passo, com que resultado.
 *
 *  É a unidade de auditoria e a fonte do teto de tentativas, da regra de um canal
 *  por janela e de todo relatório. Cresce mais rápido que qualquer outra tabela. */
export const tentativa = pgTable(
  'tentativa',
  {
    id: uuid().primaryKey().defaultRandom(),
    execucaoId: uuid()
      .notNull()
      .references(() => execucao.id, { onDelete: 'cascade' }),
    leadId: uuid()
      .notNull()
      .references(() => lead.id, { onDelete: 'cascade' }),
    clienteId: uuid()
      .notNull()
      .references(() => cliente.id, { onDelete: 'cascade' }),
    fluxoId: uuid()
      .notNull()
      .references(() => fluxo.id, { onDelete: 'cascade' }),
    pessoaId: uuid()
      .notNull()
      .references(() => pessoa.id, { onDelete: 'restrict' }),
    /** Id da etapa dentro do grafo da versão — liga a tentativa ao desenho. */
    etapaId: text().notNull(),
    canal: canalEnum().notNull(),
    destinatario: text().notNull(),
    remetente: text(),
    estado: tentativaEstadoEnum().notNull().default('agendada'),
    /** Por que não saiu: supressão, fora de janela, teto batido, template pendente. */
    motivo: text(),
    templateId: uuid(),
    provedor: text(),
    provedorId: text(),
    conteudo: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    resultado: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    erro: text(),
    dryRun: boolean().notNull().default(false),
    agendadaPara: timestamp({ withTimezone: true }).notNull(),
    executadaEm: timestamp({ withTimezone: true }),
    respondidaEm: timestamp({ withTimezone: true }),
    criadoEm: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('tentativa_execucao_idx').on(t.execucaoId),
    index('tentativa_pessoa_janela_idx').on(t.pessoaId, t.executadaEm),
    index('tentativa_cliente_idx').on(t.clienteId, t.criadoEm),
    index('tentativa_provedor_idx').on(t.provedor, t.provedorId),
  ],
)

/** O que voltou do fornecedor: entrega, leitura, resposta, bounce, opt-out,
 *  atendimento de chamada. Chega por webhook e alimenta a parada na primeira
 *  resposta e a supressão. */
export const evento = pgTable(
  'evento',
  {
    id: uuid().primaryKey().defaultRandom(),
    tentativaId: uuid().references(() => tentativa.id, { onDelete: 'cascade' }),
    pessoaId: uuid().references(() => pessoa.id, { onDelete: 'set null' }),
    canal: canalEnum().notNull(),
    tipo: eventoTipoEnum().notNull(),
    provedor: text(),
    provedorId: text(),
    payload: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    recebidoEm: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('evento_tentativa_idx').on(t.tentativaId),
    index('evento_pessoa_idx').on(t.pessoaId, t.recebidoEm),
  ],
)

/** Detalhe de uma ligação. Gravamos sempre, com aviso na abertura, e a transcrição
 *  é o que alimenta o nó de qualificação por IA. */
export const chamada = pgTable(
  'chamada',
  {
    id: uuid().primaryKey().defaultRandom(),
    tentativaId: uuid()
      .notNull()
      .references(() => tentativa.id, { onDelete: 'cascade' }),
    provedorCallId: text(),
    atendida: boolean().notNull().default(false),
    caixaPostal: boolean().notNull().default(false),
    duracaoSegundos: integer(),
    gravacaoUrl: text(),
    transcricao: text(),
    avisoGravacaoEmitido: boolean().notNull().default(false),
    encerradaEm: timestamp({ withTimezone: true }),
    criadoEm: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('chamada_tentativa_idx').on(t.tentativaId)],
)

/** Mensagem trocada em canal de texto, nos dois sentidos. Sustenta a janela de 24h
 *  do WhatsApp e a conversa livre com IA depois que o lead responde. */
export const mensagem = pgTable(
  'mensagem',
  {
    id: uuid().primaryKey().defaultRandom(),
    tentativaId: uuid().references(() => tentativa.id, { onDelete: 'cascade' }),
    pessoaId: uuid()
      .notNull()
      .references(() => pessoa.id, { onDelete: 'cascade' }),
    clienteId: uuid()
      .notNull()
      .references(() => cliente.id, { onDelete: 'cascade' }),
    canal: canalEnum().notNull(),
    entrada: boolean().notNull(),
    texto: text().notNull(),
    provedorId: text(),
    criadoEm: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('mensagem_pessoa_idx').on(t.pessoaId, t.canal, t.criadoEm)],
)
