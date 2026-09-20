CREATE TABLE "agente_voz" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cliente_id" uuid NOT NULL,
	"vapi_assistant_id" text,
	"nome" text NOT NULL,
	"idioma" text DEFAULT 'en' NOT NULL,
	"modelo_provedor" text NOT NULL,
	"modelo" text NOT NULL,
	"prompt" text NOT NULL,
	"primeira_mensagem" text NOT NULL,
	"mensagem_encerramento" text DEFAULT 'Have a great day!' NOT NULL,
	"mensagem_caixa_postal" text,
	"provedor_voz" text NOT NULL,
	"voz_id" text NOT NULL,
	"modelo_voz" text,
	"transcritor" text NOT NULL,
	"modelo_transcritor" text,
	"ajustes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"publicado_em" timestamp with time zone,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"atualizado_por" uuid,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "config_global" ADD COLUMN "voz_modelo_provedor" text DEFAULT 'openai' NOT NULL;--> statement-breakpoint
ALTER TABLE "config_global" ADD COLUMN "voz_modelo" text DEFAULT 'gpt-5.6-terra' NOT NULL;--> statement-breakpoint
ALTER TABLE "config_global" ADD COLUMN "voz_provedor_voz" text DEFAULT '11labs' NOT NULL;--> statement-breakpoint
ALTER TABLE "config_global" ADD COLUMN "voz_voz_id" text DEFAULT 'sarah' NOT NULL;--> statement-breakpoint
ALTER TABLE "config_global" ADD COLUMN "voz_modelo_voz" text DEFAULT 'eleven_multilingual_v2' NOT NULL;--> statement-breakpoint
ALTER TABLE "config_global" ADD COLUMN "voz_transcritor" text DEFAULT 'deepgram' NOT NULL;--> statement-breakpoint
ALTER TABLE "config_global" ADD COLUMN "voz_modelo_transcritor" text DEFAULT 'nova-3' NOT NULL;--> statement-breakpoint
ALTER TABLE "agente_voz" ADD CONSTRAINT "agente_voz_cliente_id_cliente_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."cliente"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agente_voz" ADD CONSTRAINT "agente_voz_atualizado_por_usuario_id_fk" FOREIGN KEY ("atualizado_por") REFERENCES "public"."usuario"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agente_voz_cliente_idx" ON "agente_voz" USING btree ("cliente_id");--> statement-breakpoint
CREATE INDEX "agente_voz_vapi_idx" ON "agente_voz" USING btree ("vapi_assistant_id");