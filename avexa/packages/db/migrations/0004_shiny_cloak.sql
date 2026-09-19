CREATE TYPE "public"."entrega_estado" AS ENUM('entregue', 'falhou', 'sem_destino', 'seco');--> statement-breakpoint
CREATE TABLE "entrega" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lead_id" uuid NOT NULL,
	"cliente_id" uuid NOT NULL,
	"execucao_id" uuid,
	"etapa_id" text,
	"destino" text NOT NULL,
	"estado" "entrega_estado" NOT NULL,
	"urgente" boolean DEFAULT false NOT NULL,
	"tentativas" integer DEFAULT 1 NOT NULL,
	"externo_id" text,
	"url" text,
	"http_status" integer,
	"erro" text,
	"dry_run" boolean DEFAULT false NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "entrega" ADD CONSTRAINT "entrega_lead_id_lead_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."lead"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entrega" ADD CONSTRAINT "entrega_cliente_id_cliente_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."cliente"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entrega" ADD CONSTRAINT "entrega_execucao_id_execucao_id_fk" FOREIGN KEY ("execucao_id") REFERENCES "public"."execucao"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "entrega_lead_idx" ON "entrega" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "entrega_cliente_idx" ON "entrega" USING btree ("cliente_id","criado_em");--> statement-breakpoint
CREATE INDEX "entrega_estado_idx" ON "entrega" USING btree ("estado","criado_em");