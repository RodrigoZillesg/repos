-- O projeto vira a unidade de operação: número, canais, agente de voz,
-- templates, destino de entrega e modo seco passam do cliente para ele.
--
-- POR QUE ESTA MIGRAÇÃO APAGA EM VEZ DE MIGRAR
-- Não há um único dado real nesta base: tudo que está nela veio do seed, e o
-- Rodrigo confirmou que nunca se cadastrou nada de verdade. Um backfill que
-- inventa um "projeto padrão" por cliente existente só para preservar dados
-- fictícios custaria mais e teria menos garantia do que recomeçar. No dia em
-- que houver cliente de verdade este atalho deixa de estar disponível, e a
-- migração seguinte terá de preservar.
--
-- O QUE ESTA MIGRAÇÃO NÃO TOCA
-- Nada na Vapi e nada no Twilio. Os assistentes e os seis números comprados
-- são as únicas coisas reais que existem, vivem fora deste banco, e nenhuma
-- linha daqui os alcança. Apagar `numero` remove a nossa anotação sobre um
-- número; não devolve número nenhum ao Twilio.
--
-- As remoções vêm antes do DDL porque as colunas novas entram como NOT NULL
-- sem padrão, e isso só passa em tabela vazia. Os utilizadores da equipe
-- sobrevivem: `usuario.cliente_id` é nulo para eles, e só quem era do portal
-- de um cliente sai junto com ele, por cascade.
DELETE FROM "cliente";--> statement-breakpoint
DELETE FROM "numero";--> statement-breakpoint
DELETE FROM "pessoa";--> statement-breakpoint
CREATE TABLE "projeto_canal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"projeto_id" uuid NOT NULL,
	"canal" "canal" NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cliente_canal" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "cliente_canal" CASCADE;--> statement-breakpoint
ALTER TABLE "numero" DROP CONSTRAINT "numero_cliente_id_cliente_id_fk";
--> statement-breakpoint
ALTER TABLE "template" DROP CONSTRAINT "template_cliente_id_cliente_id_fk";
--> statement-breakpoint
ALTER TABLE "agente_voz" DROP CONSTRAINT "agente_voz_cliente_id_cliente_id_fk";
--> statement-breakpoint
ALTER TABLE "integracao" DROP CONSTRAINT "integracao_cliente_id_cliente_id_fk";
--> statement-breakpoint
DROP INDEX "numero_cliente_idx";--> statement-breakpoint
DROP INDEX "template_cliente_canal_idx";--> statement-breakpoint
DROP INDEX "agente_voz_cliente_idx";--> statement-breakpoint
DROP INDEX "integracao_cliente_idx";--> statement-breakpoint
DROP INDEX "fluxo_slug_idx";--> statement-breakpoint
ALTER TABLE "projeto" ADD COLUMN "slug" text NOT NULL;--> statement-breakpoint
ALTER TABLE "projeto" ADD COLUMN "dry_run" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "fluxo" ADD COLUMN "projeto_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "template" ADD COLUMN "projeto_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "execucao" ADD COLUMN "projeto_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "agente_voz" ADD COLUMN "projeto_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "integracao" ADD COLUMN "projeto_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "projeto_canal" ADD CONSTRAINT "projeto_canal_projeto_id_projeto_id_fk" FOREIGN KEY ("projeto_id") REFERENCES "public"."projeto"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "projeto_canal_idx" ON "projeto_canal" USING btree ("projeto_id","canal");--> statement-breakpoint
ALTER TABLE "fluxo" ADD CONSTRAINT "fluxo_projeto_id_projeto_id_fk" FOREIGN KEY ("projeto_id") REFERENCES "public"."projeto"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "template" ADD CONSTRAINT "template_projeto_id_projeto_id_fk" FOREIGN KEY ("projeto_id") REFERENCES "public"."projeto"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execucao" ADD CONSTRAINT "execucao_projeto_id_projeto_id_fk" FOREIGN KEY ("projeto_id") REFERENCES "public"."projeto"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agente_voz" ADD CONSTRAINT "agente_voz_projeto_id_projeto_id_fk" FOREIGN KEY ("projeto_id") REFERENCES "public"."projeto"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integracao" ADD CONSTRAINT "integracao_projeto_id_projeto_id_fk" FOREIGN KEY ("projeto_id") REFERENCES "public"."projeto"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "numero_projeto_idx" ON "numero" USING btree ("projeto_id");--> statement-breakpoint
CREATE UNIQUE INDEX "projeto_slug_idx" ON "projeto" USING btree ("cliente_id","slug");--> statement-breakpoint
CREATE INDEX "fluxo_cliente_idx" ON "fluxo" USING btree ("cliente_id");--> statement-breakpoint
CREATE INDEX "template_projeto_canal_idx" ON "template" USING btree ("projeto_id","canal");--> statement-breakpoint
CREATE INDEX "agente_voz_projeto_idx" ON "agente_voz" USING btree ("projeto_id");--> statement-breakpoint
CREATE INDEX "integracao_projeto_idx" ON "integracao" USING btree ("projeto_id","tipo");--> statement-breakpoint
CREATE UNIQUE INDEX "fluxo_slug_idx" ON "fluxo" USING btree ("projeto_id","slug");--> statement-breakpoint
ALTER TABLE "cliente" DROP COLUMN "dry_run";--> statement-breakpoint
ALTER TABLE "numero" DROP COLUMN "cliente_id";--> statement-breakpoint
ALTER TABLE "template" DROP COLUMN "cliente_id";--> statement-breakpoint
ALTER TABLE "agente_voz" DROP COLUMN "cliente_id";--> statement-breakpoint
ALTER TABLE "integracao" DROP COLUMN "cliente_id";