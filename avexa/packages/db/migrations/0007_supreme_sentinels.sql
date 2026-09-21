CREATE TABLE "projeto" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cliente_id" uuid NOT NULL,
	"nome" text NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "numero" ADD COLUMN "projeto_id" uuid;--> statement-breakpoint
ALTER TABLE "projeto" ADD CONSTRAINT "projeto_cliente_id_cliente_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."cliente"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "projeto_nome_idx" ON "projeto" USING btree ("cliente_id",lower("nome"));--> statement-breakpoint
CREATE INDEX "projeto_cliente_idx" ON "projeto" USING btree ("cliente_id");--> statement-breakpoint
ALTER TABLE "numero" ADD CONSTRAINT "numero_projeto_id_projeto_id_fk" FOREIGN KEY ("projeto_id") REFERENCES "public"."projeto"("id") ON DELETE set null ON UPDATE no action;