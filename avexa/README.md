# Avexa

Painel de operação multicanal da Platty: recebe leads por webhook, executa fluxos
de contato por ligação, WhatsApp, SMS e e-mail, e entrega o lead qualificado onde
o cliente trabalha.

O brief de produto, com as decisões e as pendências, está em
[`../docs/avexa-brief.md`](../docs/avexa-brief.md).

## Estrutura

    apps/web           Painel Next.js (App Router, TypeScript) e as rotas de webhook
    apps/worker        Processo do motor de fluxo, sobre fila durável em Postgres
    packages/core      Tipos de etapa, regras, janela de contato, motor, simulador
    packages/db        Schema Drizzle, migrações e seed
    packages/adapters  Canais: Resend, WhatsApp Cloud API, Twilio, Vapi
    packages/ia        Modelo de linguagem plugável, Gemini como default
    packages/servicos  Supressão, ingestão de lead, fatos do motor, fila

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

Lead de teste ponta a ponta, contra o banco (é o passo 9 da ativação em forma
de script — relógio virtual, então uma espera de 24 horas não segura o teste):

    pnpm --filter @avexa/worker e2e
    pnpm --filter @avexa/worker e2e:optout

## Entrar no painel em desenvolvimento

Sem Resend configurado, o link mágico não sai por e-mail. Este comando gera um:

    pnpm --filter @avexa/web acesso rodrigo@platty.tech

## Rotas públicas

    POST|GET  /api/hooks/v1/<cliente>/<fluxo>   entrada de lead
    POST      /api/webhooks/<canal>             retorno do fornecedor

A entrada de lead aceita JSON, form-urlencoded e query string, e responde 200
com o motivo quando recusa (duplicado, lead velho, sem identificador). Um 4xx
faria a plataforma do cliente marcar o webhook como quebrado, e "duplicado" não
é falha de integração.

## Simulação

O botão "Rodar simulação" no construtor roda o motor de verdade — o mesmo
`simular` que os testes de CI usam — contra o grafo que está na tela, inclusive
alterações ainda não salvas, e mostra passo a passo o que aconteceria com cada
uma das cinco personas de lead. Nada sai: o simulador não conhece adaptador
nenhum. O painel mostra junto o resultado da validação, separando o que impede
de publicar do que é só aviso.

## Modo seco

Todo cliente nasce com `dry_run` ligado: o fluxo roda por inteiro, cada
tentativa fica gravada com o texto que teria sido enviado, e nenhum lead recebe
nada. É o que permite rodar em espelho antes de virar a chave.
