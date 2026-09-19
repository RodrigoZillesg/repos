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
    pnpm --filter @avexa/worker e2e:ativacao
    pnpm --filter @avexa/worker e2e:google
    pnpm --filter @avexa/worker e2e:calendly

## Entrar no painel em desenvolvimento

Sem Resend configurado, o link mágico não sai por e-mail. Este comando gera um:

    pnpm --filter @avexa/web acesso rodrigo@platty.tech

## Rotas públicas

    POST|GET  /api/hooks/v1/<cliente>/<fluxo>   entrada de lead
    POST      /api/webhooks/<canal>             retorno do fornecedor
    POST      /api/webhooks/agenda/calendly     reunião marcada ou cancelada

A entrada de lead aceita JSON, form-urlencoded e query string, e responde 200
com o motivo quando recusa (duplicado, lead velho, sem identificador). Um 4xx
faria a plataforma do cliente marcar o webhook como quebrado, e "duplicado" não
é falha de integração.

## Ativação de cliente

A aba "Ativar cliente" provisiona um cliente do zero: cadastra, reserva um
número de voz do pool no país dele, liga os canais no roteamento da Avexa, cria
a biblioteca de templates a partir dos modelos, gera os roteiros de voz, monta
os fluxos conforme os canais contratados e devolve as URLs de entrada prontas
para entregar. O cliente nasce em modo seco.

O que fica pendente vem como aviso, não como surpresa no primeiro lead — o caso
mais comum é o WhatsApp, cujos números são da Avexa mas cujos templates ainda
passam pela Meta.

A mesma função (`ativarCliente`) é usada pelo seed, para que o cliente de
desenvolvimento e o cliente de verdade não divirjam.

## Simulação

O botão "Rodar simulação" no construtor roda o motor de verdade — o mesmo
`simular` que os testes de CI usam — contra o grafo que está na tela, inclusive
alterações ainda não salvas, e mostra passo a passo o que aconteceria com cada
uma das cinco personas de lead. Nada sai: o simulador não conhece adaptador
nenhum. O painel mostra junto o resultado da validação, separando o que impede
de publicar do que é só aviso.

## Agenda: a ferramenta do cliente

O nó "Agendar reunião" não conhece calendário nenhum. Ele pede uma reunião e um
**adaptador de agenda** resolve, na ferramenta que o cliente já usa. Hoje há dois,
e eles se comportam de formas diferentes de propósito:

| | Google Calendar | Calendly |
| --- | --- | --- |
| Como agenda | marca direto num horário livre | entrega um link e o lead escolhe |
| Quando a reunião existe | na hora | quando o webhook confirma |
| Estado inicial no banco | `marcada` | `oferecida` |
| Rodízio entre consultores | sim, por `freeBusy` | quem cuida é o Calendly |

O Calendly **não** permite marcar na agenda de outra pessoa pela API, e isso é
decisão de produto deles, não limitação a contornar: quem escolhe o horário é
sempre o convidado. Então o adaptador cria um link de **uso único** (um link
reutilizável circulando por aí deixaria qualquer pessoa marcar na agenda do
cliente), o fluxo entrega esse link pelo canal seguinte como `{{link_agendamento}}`,
e a reunião só passa a existir quando `invitee.created` chega assinado. Um texto
que pede o link e não o tem **não sai** — o lead receberia uma frase cortada; a
tentativa fica registrada com motivo `sem_link_agendamento` e o lead segue para
o time, que agenda por fora.

Com as duas ferramentas conectadas, quem decide é a preferência do cliente; sem
preferência, o Calendly ganha, porque conectá-lo é um gesto mais deliberado do que
ter o Google ligado para planilha. Se a preferida estiver revogada, o motor cai na
outra em vez de parar.

Acrescentar Cal.com ou Microsoft Bookings é escrever mais um adaptador: nenhum
fluxo de cliente precisa mudar.

## Google Workspace

Cada cliente conecta a própria conta pela aba Integrações. A Avexa não é dona da
agenda nem da planilha de ninguém: guardamos só o refresh token, **cifrado em
repouso** com `APP_SECRET` (AES-256-GCM, amarrado ao cliente e ao tipo — um
segredo movido de um cliente para outro no banco não decifra).

- **Calendar** consulta os horários ocupados, oferece um livre dentro da janela de
  contato do lead, faz o rodízio entre consultores e cria o evento com o lead
  convidado e link do Meet.
- **Sheets** dá vida ao destino "Planilha compartilhada".

Escopos mínimos: `calendar.events` e `calendar.readonly` (nunca o `/auth/calendar`
amplo, que permitiria apagar agendas do cliente) e `spreadsheets`.

Um consultor que não compartilhou a agenda fica **de fora do rodízio**, não entra
como se estivesse livre — tratar "sem permissão" como agenda vazia marcaria
reunião em cima de compromisso existente.

Acesso revogado pelo cliente desliga a integração e pede reconexão, em vez de
tentar renovar a cada lead.

## Calendly

Mesma aba Integrações, mesmo cofre de segredo. Duas diferenças que importam na
operação:

- O operador escolhe **qual tipo de evento** o fluxo oferece (uma conversa de 30
  min não é uma aula demonstrativa de 60). Sem essa escolha o nó de agenda falha
  dizendo o que fazer, em vez de devolver erro de fornecedor.
- O webhook de confirmação só é aceito com `CALENDLY_SIGNING_KEY`: sem chave a
  rota recusa tudo (`503`), porque um webhook aberto deixaria qualquer um inventar
  reunião no painel do cliente. A assinatura é conferida sobre o corpo **cru** —
  reserializar o JSON muda espaço e ordem de chave e a assinatura deixa de bater —
  com janela de tolerância contra replay.

Reunião marcada pelo link público do cliente, fora de um fluxo nosso, não casa com
lead nenhum. Isso não é erro: a rota responde `200` (senão o Calendly reenviaria
para sempre) e diz que não casou.

## Monitor

A aba Monitor responde as perguntas que este produto esconde quando falha: está
saindo contato, o que barrou, e tem lead parado. Uma pequena série por canal na
mesma escala de dias — um canal que some do desenho aparece marcado em vermelho,
e um canal que o cliente não contratou diz isso em vez de mostrar um gráfico
vazio, que são coisas diferentes.

### Cores de canal

A paleta categórica é validada, não escolhida a olho:

    node <dataviz>/scripts/validate_palette.js \
      "#cf5604,#a90e88,#009351,#2b7ad6" --mode light --pairs all

Passa nos seis testes nos dois modos. O par crítico é verde↔laranja, a ΔE 8,0 em
deuteranopia — dentro da faixa que só é legal com codificação secundária, e por
isso todo ponto de canal anda com o nome do canal ao lado e toda série tem
tabela. O SMS deixou de ser âmbar porque âmbar e vermelho não alcançam o piso de
separação em visão normal sobre fundo claro: o âmbar claro o bastante para
separar não chega a 3:1 de contraste, e o escuro o bastante para o contraste
vira marrom.

## Modo seco

Todo cliente nasce com `dry_run` ligado: o fluxo roda por inteiro, cada
tentativa fica gravada com o texto que teria sido enviado, e nenhum lead recebe
nada. É o que permite rodar em espelho antes de virar a chave.
