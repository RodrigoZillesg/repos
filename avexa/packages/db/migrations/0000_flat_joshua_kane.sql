CREATE TYPE "public"."canal" AS ENUM('ligacao', 'whatsapp', 'sms', 'email', 'telegram');--> statement-breakpoint
CREATE TYPE "public"."cliente_status" AS ENUM('ativando', 'ativo', 'pausado', 'encerrado');--> statement-breakpoint
CREATE TYPE "public"."evento_tipo" AS ENUM('entregue', 'lida', 'respondida', 'bounce', 'reclamacao', 'optout', 'atendida', 'nao_atendida', 'caixa_postal', 'falha');--> statement-breakpoint
CREATE TYPE "public"."execucao_estado" AS ENUM('executando', 'aguardando', 'concluida', 'cancelada', 'falhou');--> statement-breakpoint
CREATE TYPE "public"."fluxo_status" AS ENUM('rascunho', 'publicado', 'pausado');--> statement-breakpoint
CREATE TYPE "public"."idioma" AS ENUM('pt-BR', 'en');--> statement-breakpoint
CREATE TYPE "public"."integracao_tipo" AS ENUM('hubspot', 'google_calendar', 'google_sheets', 'webhook', 'email_time');--> statement-breakpoint
CREATE TYPE "public"."numero_status" AS ENUM('livre', 'reservado', 'atribuido', 'inativo');--> statement-breakpoint
CREATE TYPE "public"."papel" AS ENUM('admin', 'operacao', 'designer', 'copy', 'cliente');--> statement-breakpoint
CREATE TYPE "public"."supressao_tipo" AS ENUM('telefone', 'email');--> statement-breakpoint
CREATE TYPE "public"."template_status" AS ENUM('rascunho', 'pendente', 'aprovado', 'rejeitado');--> statement-breakpoint
CREATE TYPE "public"."tentativa_estado" AS ENUM('agendada', 'suprimida', 'enviada', 'entregue', 'lida', 'respondida', 'falhou', 'cancelada');--> statement-breakpoint
CREATE TABLE "cliente" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"nome" text NOT NULL,
	"setor" text,
	"fuso_horario" text DEFAULT 'Australia/Sydney' NOT NULL,
	"idioma_padrao" "idioma" DEFAULT 'en' NOT NULL,
	"status" "cliente_status" DEFAULT 'ativando' NOT NULL,
	"dry_run" boolean DEFAULT true NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cliente_canal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cliente_id" uuid NOT NULL,
	"canal" "canal" NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "numero" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"e164" text NOT NULL,
	"provedor" text DEFAULT 'twilio' NOT NULL,
	"provedor_sid" text,
	"capacidades" jsonb DEFAULT '["voz","sms"]'::jsonb NOT NULL,
	"status" "numero_status" DEFAULT 'livre' NOT NULL,
	"cliente_id" uuid,
	"assistente_id" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessao" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"usuario_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expira_em" timestamp with time zone NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "token_acesso" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"usuario_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expira_em" timestamp with time zone NOT NULL,
	"usado_em" timestamp with time zone,
	"ip" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usuario" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"nome" text NOT NULL,
	"papel" "papel" NOT NULL,
	"cliente_id" uuid,
	"idioma" "idioma" DEFAULT 'pt-BR' NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"ultimo_acesso_em" timestamp with time zone,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fluxo" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cliente_id" uuid NOT NULL,
	"nome" text NOT NULL,
	"slug" text NOT NULL,
	"status" "fluxo_status" DEFAULT 'rascunho' NOT NULL,
	"versao_publicada_id" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fluxo_versao" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fluxo_id" uuid NOT NULL,
	"versao" integer NOT NULL,
	"grafo" jsonb NOT NULL,
	"publicada_em" timestamp with time zone,
	"publicada_por" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "template" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cliente_id" uuid NOT NULL,
	"canal" "canal" NOT NULL,
	"nome" text NOT NULL,
	"idioma" "idioma" DEFAULT 'en' NOT NULL,
	"assunto" text,
	"corpo" text DEFAULT '' NOT NULL,
	"variaveis" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "template_status" DEFAULT 'rascunho' NOT NULL,
	"meta_template_id" text,
	"meta_status" text,
	"meta_motivo_rejeicao" text,
	"meta_submetido_em" timestamp with time zone,
	"hash_aprovado" text,
	"arquivado" boolean DEFAULT false NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lead" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cliente_id" uuid NOT NULL,
	"fluxo_id" uuid NOT NULL,
	"pessoa_id" uuid NOT NULL,
	"nome" text,
	"telefone" text,
	"email" text,
	"fuso_horario" text,
	"idioma" text,
	"dados" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"campos" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"utm" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dedupe_key" text NOT NULL,
	"score" integer,
	"score_motivo" text,
	"resumo" text,
	"etiquetas" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pessoa" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"telefone" text,
	"email" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supressao" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tipo" "supressao_tipo" NOT NULL,
	"valor" text NOT NULL,
	"pessoa_id" uuid,
	"motivo" text NOT NULL,
	"canal_origem" "canal",
	"cliente_origem_id" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chamada" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tentativa_id" uuid NOT NULL,
	"provedor_call_id" text,
	"atendida" boolean DEFAULT false NOT NULL,
	"caixa_postal" boolean DEFAULT false NOT NULL,
	"duracao_segundos" integer,
	"gravacao_url" text,
	"transcricao" text,
	"aviso_gravacao_emitido" boolean DEFAULT false NOT NULL,
	"encerrada_em" timestamp with time zone,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evento" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tentativa_id" uuid,
	"pessoa_id" uuid,
	"canal" "canal" NOT NULL,
	"tipo" "evento_tipo" NOT NULL,
	"provedor" text,
	"provedor_id" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"recebido_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "execucao" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"cliente_id" uuid NOT NULL,
	"fluxo_id" uuid NOT NULL,
	"fluxo_versao_id" uuid NOT NULL,
	"estado" "execucao_estado" DEFAULT 'executando' NOT NULL,
	"posicao" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"contexto" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"tentativas_feitas" integer DEFAULT 0 NOT NULL,
	"profundidade" integer DEFAULT 0 NOT NULL,
	"cadeia" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"execucao_pai_id" uuid,
	"dry_run" boolean DEFAULT false NOT NULL,
	"retomar_em" timestamp with time zone,
	"motivo_encerramento" text,
	"iniciado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"encerrado_em" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "mensagem" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tentativa_id" uuid,
	"pessoa_id" uuid NOT NULL,
	"cliente_id" uuid NOT NULL,
	"canal" "canal" NOT NULL,
	"entrada" boolean NOT NULL,
	"texto" text NOT NULL,
	"provedor_id" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tentativa" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"execucao_id" uuid NOT NULL,
	"lead_id" uuid NOT NULL,
	"cliente_id" uuid NOT NULL,
	"fluxo_id" uuid NOT NULL,
	"pessoa_id" uuid NOT NULL,
	"etapa_id" text NOT NULL,
	"canal" "canal" NOT NULL,
	"destinatario" text NOT NULL,
	"remetente" text,
	"estado" "tentativa_estado" DEFAULT 'agendada' NOT NULL,
	"motivo" text,
	"template_id" uuid,
	"provedor" text,
	"provedor_id" text,
	"conteudo" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"resultado" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"erro" text,
	"dry_run" boolean DEFAULT false NOT NULL,
	"agendada_para" timestamp with time zone NOT NULL,
	"executada_em" timestamp with time zone,
	"respondida_em" timestamp with time zone,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auditoria" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"usuario_id" uuid,
	"cliente_id" uuid,
	"acao" text NOT NULL,
	"entidade" text NOT NULL,
	"entidade_id" text,
	"detalhe" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "config_global" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"teto_tentativas" integer DEFAULT 5 NOT NULL,
	"janela_inicio_min" integer DEFAULT 540 NOT NULL,
	"janela_fim_min" integer DEFAULT 1200 NOT NULL,
	"contatar_sabado" boolean DEFAULT false NOT NULL,
	"contatar_domingo" boolean DEFAULT false NOT NULL,
	"intervalo_minimo_min" integer DEFAULT 60 NOT NULL,
	"profundidade_max_subfluxo" integer DEFAULT 3 NOT NULL,
	"retencao_lead_dias" integer DEFAULT 0 NOT NULL,
	"retencao_gravacao_dias" integer DEFAULT 0 NOT NULL,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_por" uuid
);
--> statement-breakpoint
CREATE TABLE "integracao" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cliente_id" uuid NOT NULL,
	"tipo" "integracao_tipo" NOT NULL,
	"nome" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"segredo" text,
	"ativo" boolean DEFAULT true NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cliente_canal" ADD CONSTRAINT "cliente_canal_cliente_id_cliente_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."cliente"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "numero" ADD CONSTRAINT "numero_cliente_id_cliente_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."cliente"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessao" ADD CONSTRAINT "sessao_usuario_id_usuario_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "token_acesso" ADD CONSTRAINT "token_acesso_usuario_id_usuario_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usuario" ADD CONSTRAINT "usuario_cliente_id_cliente_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."cliente"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fluxo" ADD CONSTRAINT "fluxo_cliente_id_cliente_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."cliente"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fluxo_versao" ADD CONSTRAINT "fluxo_versao_fluxo_id_fluxo_id_fk" FOREIGN KEY ("fluxo_id") REFERENCES "public"."fluxo"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fluxo_versao" ADD CONSTRAINT "fluxo_versao_publicada_por_usuario_id_fk" FOREIGN KEY ("publicada_por") REFERENCES "public"."usuario"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template" ADD CONSTRAINT "template_cliente_id_cliente_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."cliente"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead" ADD CONSTRAINT "lead_cliente_id_cliente_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."cliente"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead" ADD CONSTRAINT "lead_fluxo_id_fluxo_id_fk" FOREIGN KEY ("fluxo_id") REFERENCES "public"."fluxo"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead" ADD CONSTRAINT "lead_pessoa_id_pessoa_id_fk" FOREIGN KEY ("pessoa_id") REFERENCES "public"."pessoa"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supressao" ADD CONSTRAINT "supressao_pessoa_id_pessoa_id_fk" FOREIGN KEY ("pessoa_id") REFERENCES "public"."pessoa"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supressao" ADD CONSTRAINT "supressao_cliente_origem_id_cliente_id_fk" FOREIGN KEY ("cliente_origem_id") REFERENCES "public"."cliente"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "chamada" ADD CONSTRAINT "chamada_tentativa_id_tentativa_id_fk" FOREIGN KEY ("tentativa_id") REFERENCES "public"."tentativa"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evento" ADD CONSTRAINT "evento_tentativa_id_tentativa_id_fk" FOREIGN KEY ("tentativa_id") REFERENCES "public"."tentativa"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evento" ADD CONSTRAINT "evento_pessoa_id_pessoa_id_fk" FOREIGN KEY ("pessoa_id") REFERENCES "public"."pessoa"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execucao" ADD CONSTRAINT "execucao_lead_id_lead_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."lead"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execucao" ADD CONSTRAINT "execucao_cliente_id_cliente_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."cliente"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execucao" ADD CONSTRAINT "execucao_fluxo_id_fluxo_id_fk" FOREIGN KEY ("fluxo_id") REFERENCES "public"."fluxo"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execucao" ADD CONSTRAINT "execucao_fluxo_versao_id_fluxo_versao_id_fk" FOREIGN KEY ("fluxo_versao_id") REFERENCES "public"."fluxo_versao"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mensagem" ADD CONSTRAINT "mensagem_tentativa_id_tentativa_id_fk" FOREIGN KEY ("tentativa_id") REFERENCES "public"."tentativa"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mensagem" ADD CONSTRAINT "mensagem_pessoa_id_pessoa_id_fk" FOREIGN KEY ("pessoa_id") REFERENCES "public"."pessoa"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mensagem" ADD CONSTRAINT "mensagem_cliente_id_cliente_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."cliente"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tentativa" ADD CONSTRAINT "tentativa_execucao_id_execucao_id_fk" FOREIGN KEY ("execucao_id") REFERENCES "public"."execucao"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tentativa" ADD CONSTRAINT "tentativa_lead_id_lead_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."lead"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tentativa" ADD CONSTRAINT "tentativa_cliente_id_cliente_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."cliente"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tentativa" ADD CONSTRAINT "tentativa_fluxo_id_fluxo_id_fk" FOREIGN KEY ("fluxo_id") REFERENCES "public"."fluxo"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tentativa" ADD CONSTRAINT "tentativa_pessoa_id_pessoa_id_fk" FOREIGN KEY ("pessoa_id") REFERENCES "public"."pessoa"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auditoria" ADD CONSTRAINT "auditoria_usuario_id_usuario_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auditoria" ADD CONSTRAINT "auditoria_cliente_id_cliente_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."cliente"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "config_global" ADD CONSTRAINT "config_global_atualizado_por_usuario_id_fk" FOREIGN KEY ("atualizado_por") REFERENCES "public"."usuario"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integracao" ADD CONSTRAINT "integracao_cliente_id_cliente_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."cliente"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cliente_slug_idx" ON "cliente" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "cliente_canal_idx" ON "cliente_canal" USING btree ("cliente_id","canal");--> statement-breakpoint
CREATE UNIQUE INDEX "numero_e164_idx" ON "numero" USING btree ("e164");--> statement-breakpoint
CREATE INDEX "numero_cliente_idx" ON "numero" USING btree ("cliente_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sessao_hash_idx" ON "sessao" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessao_usuario_idx" ON "sessao" USING btree ("usuario_id");--> statement-breakpoint
CREATE UNIQUE INDEX "token_acesso_hash_idx" ON "token_acesso" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "usuario_email_idx" ON "usuario" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "fluxo_slug_idx" ON "fluxo" USING btree ("cliente_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "fluxo_versao_idx" ON "fluxo_versao" USING btree ("fluxo_id","versao");--> statement-breakpoint
CREATE INDEX "template_cliente_canal_idx" ON "template" USING btree ("cliente_id","canal");--> statement-breakpoint
CREATE INDEX "lead_cliente_idx" ON "lead" USING btree ("cliente_id","criado_em");--> statement-breakpoint
CREATE INDEX "lead_pessoa_idx" ON "lead" USING btree ("pessoa_id");--> statement-breakpoint
CREATE INDEX "lead_dedupe_idx" ON "lead" USING btree ("dedupe_key");--> statement-breakpoint
CREATE UNIQUE INDEX "pessoa_telefone_idx" ON "pessoa" USING btree ("telefone");--> statement-breakpoint
CREATE UNIQUE INDEX "pessoa_email_idx" ON "pessoa" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "supressao_valor_idx" ON "supressao" USING btree ("tipo","valor");--> statement-breakpoint
CREATE INDEX "chamada_tentativa_idx" ON "chamada" USING btree ("tentativa_id");--> statement-breakpoint
CREATE INDEX "evento_tentativa_idx" ON "evento" USING btree ("tentativa_id");--> statement-breakpoint
CREATE INDEX "evento_pessoa_idx" ON "evento" USING btree ("pessoa_id","recebido_em");--> statement-breakpoint
CREATE INDEX "execucao_lead_idx" ON "execucao" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "execucao_retomar_idx" ON "execucao" USING btree ("estado","retomar_em");--> statement-breakpoint
CREATE INDEX "execucao_cliente_idx" ON "execucao" USING btree ("cliente_id","iniciado_em");--> statement-breakpoint
CREATE INDEX "mensagem_pessoa_idx" ON "mensagem" USING btree ("pessoa_id","canal","criado_em");--> statement-breakpoint
CREATE INDEX "tentativa_execucao_idx" ON "tentativa" USING btree ("execucao_id");--> statement-breakpoint
CREATE INDEX "tentativa_pessoa_janela_idx" ON "tentativa" USING btree ("pessoa_id","executada_em");--> statement-breakpoint
CREATE INDEX "tentativa_cliente_idx" ON "tentativa" USING btree ("cliente_id","criado_em");--> statement-breakpoint
CREATE INDEX "tentativa_provedor_idx" ON "tentativa" USING btree ("provedor","provedor_id");--> statement-breakpoint
CREATE INDEX "auditoria_entidade_idx" ON "auditoria" USING btree ("entidade","entidade_id","criado_em");--> statement-breakpoint
CREATE INDEX "integracao_cliente_idx" ON "integracao" USING btree ("cliente_id","tipo");