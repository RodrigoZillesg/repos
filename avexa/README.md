# Avexa

Painel de operação multicanal da Platty: recebe leads por webhook, executa fluxos
de contato por ligação, WhatsApp, SMS e e-mail, e entrega o lead qualificado onde
o cliente trabalha.

O brief de produto, com as decisões e as pendências, está em
[`../docs/avexa-brief.md`](../docs/avexa-brief.md).

## Estrutura

    apps/web         Painel Next.js (App Router, TypeScript) e as rotas de webhook
    apps/worker      Processo do motor de fluxo, sobre fila durável em Postgres
    packages/core    Tipos de etapa, regras do motor, janela de contato, adaptadores
    packages/db      Schema Drizzle e migrações
    packages/adapters Implementações de canal: Resend, WhatsApp Cloud API, Twilio, Vapi

`packages/core` não importa nada de `db` nem de `adapters`: ele define a interface
e as regras, e os outros dependem dele. É o que mantém o motor ignorante sobre
quem é o fornecedor de cada canal.

## Desenvolvimento

    pnpm install
    docker compose up -d postgres
    pnpm db:migrate
    pnpm db:seed
    pnpm dev

Testes do núcleo, sem build e sem banco:

    pnpm --filter @avexa/core test
