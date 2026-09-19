# Avexa — Brief de Produto

> Documento vivo. Origem: entrevista estruturada de 2026-09-19 sobre o artefato de
> simulação "Avexa — Painel de Operação". Registra decisões tomadas, não hipóteses.

## 1. Objetivo

Orquestrar o contato multicanal com leads dos clientes da Platty — ligação com
assistente de IA, WhatsApp, SMS e e-mail — a partir de fluxos desenhados num
construtor visual, substituindo a automação montada à mão em n8n/Make que atende
os clientes hoje.

A promessa central: pôr um cliente novo no ar sem que ele crie conta, cadastre
cartão, configure DNS ou registre número em canal nenhum. Ele recebe **uma URL de
webhook**, cola na saída do formulário dele, e o resto é provisionado pelo painel.

## 2. Destinatários

| Quem | Acesso |
|---|---|
| Administrador | Tudo: clientes, fluxos, templates, dados de lead |
| Operação | Monta e ajusta fluxos, edita templates; não administra contas |
| Designer | Só a biblioteca de e-mail. Não vê fluxos, clientes nem dados de lead |
| Copywriter | Textos de WhatsApp, SMS e e-mail. Não vê fluxos nem dados de lead |
| Cliente final | **Somente leitura**: os próprios leads, score, resumo, transcrição e status |

Equipe inicial: Rodrigo (admin), Enzo (operação), Paulo (designer), Sebastian (copy).
Clientes-semente: International House, LanguageBird, English Australia.

O acesso do cliente final é uma decisão que **diverge do artefato** (que afirmava
"o cliente não cria conta em lugar nenhum"). Mantido de propósito, em escopo mínimo.

## 3. Fluxo de ativação de um cliente (9 passos)

1. Cadastrar cliente — nome, o que vende, canais contratados, janela de contato, destino dos leads
2. Gerar as URLs de entrada — uma por fluxo, prontas para UTMs e campos personalizados
3. Reservar o número de voz — do pool; voz é o único canal com número dedicado
4. Ligar WhatsApp e SMS — entra no roteamento dos números da marca Avexa, sem cadastro novo
5. Criar os templates de e-mail — a partir dos modelos Avexa, já com cor e logo do cliente
6. Gerar roteiro de voz e textos — pré-preenchidos, prontos para revisão do copywriter
7. Montar os fluxos — modelos carregados conforme os canais contratados
8. **Cliente cola a URL e publica o opt-in** — único passo que depende dele
9. Rodar o lead de teste — contato real ponta a ponta antes de abrir a torneira

## 4. Inputs

- **Lead**, via webhook por fluxo (`https://hooks.avexa.app/v1/<cliente>/<slug>`):
  POST JSON / form-urlencoded ou GET query string. Campos nomeados pelo cliente,
  mais `utm_*` capturadas automaticamente e campos personalizados livres.
  Controles no próprio nó de entrada: idade máxima do lead (15min a 72h) e política
  de duplicado (ignorar / atualizar sem recontatar / recontatar após 30 dias).
- **Templates** por cliente e canal (e-mail, WhatsApp, SMS), com variáveis.
- **Roteiro de voz** e base de conhecimento por cliente.
- **Configuração do cliente**: canais contratados, janela de contato, fuso, destino de entrega.

## 5. Outputs

- Contato efetivo no canal escolhido, respeitando as regras do motor.
- **Registro de tentativa** — para quem, de qual cliente, em qual fluxo, por qual
  canal, em que passo, com que resultado. É a unidade de auditoria do sistema.
- Score de 0 a 100 com justificativa, resumo e transcrição.
- Entrega do lead qualificado em: HubSpot CRM, e-mail do time, Google Sheets ou
  webhook do cliente (com retry).
- Reunião agendada no Google Calendar do time do cliente, com lembrete.

## 6. Regras que o motor aplica sozinho

1. **Um canal por janela** — nunca dois disparos para a mesma pessoa na mesma janela, mesmo que o fluxo peça
2. **Parada na primeira resposta** — respondeu em qualquer canal, o resto da sequência é cancelado
3. **Opt-out universal** — bloqueia todos os canais, para sempre, em qualquer cliente
4. **Só em horário útil** — no fuso do lead; fora da janela, a tentativa espera a manhã seguinte
5. **Teto de tentativas** — o fluxo pode pedir menos que o teto do sistema, nunca mais
6. **Anti-laço em subfluxo** — a cadeia é cortada se um subfluxo voltar ao ponto de partida

**Supressão é global e por pessoa**: um opt-out vindo por qualquer canal bloqueia
o telefone *e* o e-mail daquele lead, em todos os clientes e todos os canais.
Ninguém tem lista própria.

## 7. Exceções e casos limite

- **Espera não conta fora da janela** — uma espera de 2h disparada às 19h continua na manhã seguinte.
- **Janela de 24h do WhatsApp** — fora dela, só template aprovado; depois da resposta do lead, conversa livre.
- **Template WhatsApp** — trocar valor de variável não exige nova aprovação da Meta; mudar texto fixo, sim. A submissão é feita pelo painel via API, com acompanhamento de status, e o nó só libera quando aprovado.
- **Concentração de voz** — muita chamada num mesmo número derruba a taxa de atendimento; o pool precisa ser distribuído.
- **Gravação de chamada** — gravar sempre, com aviso na abertura da ligação (cobre estados de consentimento bilateral nos EUA e na Austrália).
- **Lead velho ou duplicado** — descartado ou atualizado conforme a política do nó de entrada.
- **Falha de webhook de saída** — reenvio automático (3 ou 5 tentativas) ou seguir sem reenviar.

## 8. Critérios de qualidade

- Nenhum contato fora da janela de horário local do lead.
- Nenhum contato com pessoa na lista de supressão, em nenhum cliente.
- Toda tentativa rastreável até o passo do fluxo que a originou.
- Estado do fluxo sobrevive a deploy e reinício (espera de 3 dias não se perde).
- Trocar de fornecedor de canal não exige tocar em fluxo de cliente nenhum.
- Designer e copywriter conseguem trabalhar sem nunca ver dado de lead.

## 9. Decisões técnicas

| Tema | Decisão |
|---|---|
| Escopo | Produto real, fullstack — canais falam com fornecedores de verdade |
| Stack | Next.js (App Router, TypeScript) + Postgres + worker próprio |
| Fila | Durável em Postgres (pg-boss). Sem Redis, sem SaaS de workflow |
| Hospedagem | VPS Hostinger com Docker (app + worker + Postgres + proxy) |
| E-mail | Resend, conexão única da Avexa, remetente do domínio Avexa |
| WhatsApp | Cloud API oficial, WABA da marca Avexa |
| SMS + telefonia | Twilio — mesmo número para SMS e ligação, para o lead reconhecer a origem |
| Voz com IA | Vapi, com número importado do Twilio |
| LLM | Camada plugável, **Gemini** como default |
| Marca | Avexa é definitiva (`hooks.avexa.app`, remetente e painel) |
| Idioma | Painel bilíngue PT/EN desde o começo |
| Escala alvo | 10-20 clientes, alguns milhares de leads/mês |
| Transição | Corte seco: n8n segue intocado até a virada, os três clientes passam juntos |
| Entrega | Escopo completo de uma vez, sem fatiar |

### Arquitetura em 4 camadas

    Painel Avexa      cadastro · construtor · templates · papéis · provisionamento · monitor
          ↓
    Motor de fluxo    fila de tentativas · agendador · condições · subfluxo · cadência · supressão
          ↓
    Adaptadores       mesma interface: enviar, receber, status
          ↓
    Fornecedores      Twilio · Vapi · WhatsApp Cloud API · Resend

O motor não sabe o que é Resend nem o que é WhatsApp: emite uma intenção de contato
e o adaptador traduz. Acrescentar Telegram é escrever um adaptador novo, sem tocar
em fluxo existente.

### Tipos de nó do construtor (17)

- **Início** — Entrada de lead (fixo)
- **Controle** — Checar permissão · Esperar · Condição · Repetir · Executar outro fluxo · Marcar lead
- **Canais** — Ligação · WhatsApp · SMS · E-mail
- **Integração** — Webhook de saída
- **Inteligência** — Qualificar com IA · Agendar reunião
- **Saída** — Entregar ao time · Encerrar

## 10. Riscos e pendências

| # | Item | Situação |
|---|---|---|
| 1 | **Export dos fluxos n8n/Make** dos três clientes | **Bloqueia o motor.** São a especificação real — cadência, textos e condições já validados com leads de verdade |
| 2 | **Payload real do webhook** do International House | **Bloqueia o nó de entrada.** Preciso dos nomes de campo como eles chegam hoje |
| 3 | Corte seco + entrega sem fatiar concentra risco num dia só | Mitigação acordada: modo *dry-run* por cliente, para rodar em espelho contra o n8n antes da virada |
| 4 | Região do VPS Hostinger vs. leads AU/US | A definir — afeta latência de telefonia e postura de privacidade |
| 5 | Teto de tentativas do sistema, valor numérico | A definir |
| 6 | Convite e autenticação do cliente final | A definir — como ele recebe acesso sem "criar conta" |

## 11. Próxima ação

1. Obter os itens 1 e 2 das pendências.
2. Modelar o schema Postgres a partir deles — em especial `tentativa` e `supressao`.
3. Só então escrever o motor de fluxo.
