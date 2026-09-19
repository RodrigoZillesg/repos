CREATE TYPE "public"."provedor_agenda" AS ENUM('google_calendar', 'calendly');--> statement-breakpoint
CREATE TYPE "public"."reuniao_status" AS ENUM('oferecida', 'marcada', 'cancelada');--> statement-breakpoint
ALTER TYPE "public"."integracao_tipo" ADD VALUE 'calendly' BEFORE 'webhook';--> statement-breakpoint
CREATE TABLE "reuniao" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"cliente_id" uuid NOT NULL,
	"execucao_id" uuid,
	"provedor" "provedor_agenda" NOT NULL,
	"status" "reuniao_status" DEFAULT 'oferecida' NOT NULL,
	"externo_id" text,
	"responsavel" text,
	"inicio" timestamp with time zone,
	"fim" timestamp with time zone,
	"link_agendamento" text,
	"link_evento" text,
	"conferencia" text,
	"motivo_cancelamento" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmada_em" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "reuniao" ADD CONSTRAINT "reuniao_lead_id_lead_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."lead"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reuniao" ADD CONSTRAINT "reuniao_cliente_id_cliente_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."cliente"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reuniao" ADD CONSTRAINT "reuniao_execucao_id_execucao_id_fk" FOREIGN KEY ("execucao_id") REFERENCES "public"."execucao"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reuniao_lead_idx" ON "reuniao" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "reuniao_cliente_idx" ON "reuniao" USING btree ("cliente_id","inicio");--> statement-breakpoint
CREATE INDEX "reuniao_externo_idx" ON "reuniao" USING btree ("provedor","externo_id");