# Subir o Avexa no VPS

Uma máquina, quatro contêineres: Postgres, painel, worker e Caddy. Só o Caddy
fala com a internet; o banco não publica porta nenhuma.

O deploy sai do GitHub Actions, não da máquina de ninguém. Assim a chave privada
mora num secret do repositório, cada subida fica registrada com autor e hora, e
o que vai para produção é exatamente o que está na branch.

## Uma vez só

### 1. A chave, na sua máquina

```sh
ssh-keygen -t ed25519 -C 'deploy@avexa' -f ~/.ssh/avexa_deploy -N ''
```

A **privada** (`~/.ssh/avexa_deploy`) nunca sai da sua máquina, a não ser para o
secret do GitHub. Não cole em chat, não mande por e-mail, não ponha no servidor.

### 2. Preparar o servidor

Entre pelo console web da Hostinger (ou `ssh root@31.97.128.229`), mande o
`bootstrap.sh` para lá e rode com a **pública** como argumento:

```sh
bash bootstrap.sh "$(cat ~/.ssh/avexa_deploy.pub)"
```

Ele instala Docker, cria o usuário `avexa`, abre 22/80/443 no firewall, liga o
fail2ban e gera `/opt/avexa/app/.env` com `APP_SECRET` e senha de banco novos.
Pode rodar de novo quando quiser: nada é refeito nem sobrescrito — em especial o
`.env`, porque segredo sobrescrito é integração quebrada em todos os clientes.

> **Guarde uma cópia do `APP_SECRET`.** É a chave que cifra os refresh tokens de
> Google, Calendly e HubSpot em repouso. Perdê-la significa cada cliente
> reconectar tudo à mão.

### 3. Secrets no GitHub

Em **Settings › Secrets and variables › Actions**:

| Nome | Valor |
| --- | --- |
| `VPS_HOST` | `31.97.128.229` |
| `VPS_USER` | `avexa` |
| `VPS_SSH_KEY` | conteúdo de `~/.ssh/avexa_deploy` (a privada, inteira, com as linhas `BEGIN`/`END`) |

### 4. DNS

Dois registros `A` apontando para `31.97.128.229`:

```
app.avexa.global     A    31.97.128.229
hooks.avexa.global   A    31.97.128.229
```

O Caddy pede o certificado sozinho no primeiro acesso. Se o DNS ainda não
propagou, o certificado falha e o painel responde erro de TLS — espere e rode o
deploy de novo, não há nada a consertar.

O workflow usa um *environment* do GitHub chamado `producao`, criado sozinho na
primeira execução. Ele não muda nada hoje; existe para o dia em que você quiser
exigir aprovação de alguém antes de um deploy.

## Cada deploy

Aba **Actions › Deploy › Run workflow**. Na primeira vez, marque **seed** para
criar os clientes e fluxos de exemplo.

O workflow roda typecheck e testes antes de tocar no servidor, envia o código
por `rsync`, constrói as imagens, aplica as migrações, sobe tudo e só termina
quando `https://app.avexa.global/entrar` responde 200. Se não responder, ele
despeja os últimos logs do `web` e do `caddy` no próprio job e falha.

## Quando precisar mexer à mão

Tudo a partir de `/opt/avexa/app`, como usuário `avexa`:

```sh
compose() { docker compose --env-file .env -f infra/docker-compose.prod.yml "$@"; }

compose ps                      # o que está de pé
compose logs -f worker          # o motor trabalhando
compose logs -f web             # o painel
bash infra/deploy-remoto.sh     # o mesmo deploy, sem depender do GitHub
compose restart worker          # depois de mexer no .env
```

Primeiro acesso ao painel, sem Resend configurado (o link mágico não sai por
e-mail; este comando imprime um):

```sh
compose run --rm worker pnpm --filter @avexa/web acesso \
  rodrigo@platty.tech https://app.avexa.global
```

O link vale 15 minutos e funciona uma vez só. Depois que o Resend estiver
configurado isso deixa de ser necessário: o link chega por e-mail.

## Backup

O que não pode ser perdido é o volume do Postgres — leads, execuções, supressão
e os segredos cifrados das integrações:

```sh
docker exec avexa-postgres-1 pg_dump -U avexa avexa | gzip > /opt/avexa/backups/avexa-$(date +%F).sql.gz
```

Vale pôr no cron e mandar para fora da máquina. Backup que mora no mesmo disco
que o banco não é backup.

## O que este arranjo não tem ainda

Dito na cara, para ninguém descobrir no dia errado:

- **Sem réplica e sem failover.** Uma máquina. Se ela cair, o Avexa cai junto —
  os leads ficam na fila do cliente, não se perdem, mas ninguém é contatado.
- **Backup não está automatizado**, só documentado acima.
- **Sem staging.** O deploy vai direto para produção. Os testes e os e2e do CI
  são o que separa uma mudança ruim de um lead real.
- **A identidade do servidor é aceita a cada deploy** (`ssh-keyscan`), em vez de
  comparada com uma impressão digital fixa. Para fechar isso, guarde a saída de
  `ssh-keyscan 31.97.128.229` num secret e use-a no lugar do keyscan.
- **Build no próprio servidor.** Simples e sem registro de imagens, mas ocupa
  CPU e RAM da máquina durante o deploy. Se começar a doer, o caminho é
  construir no runner e publicar no GHCR.
