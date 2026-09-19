# Subir o Avexa no VPS

A máquina pode já estar servindo outras coisas. Tudo aqui foi escrito para o
Avexa **conviver**, não para tomar conta: contêineres com prefixo próprio,
volumes próprios, rede própria, e nenhuma mudança em estado global da máquina
sem você pedir explicitamente.

> **Esta máquina não é só nossa.** O diagnóstico de 19/09 encontrou outro
> produto chamado Avexa já no ar — `github.com/andreplattytech/avexa` em
> `/opt/avexa`, cinco projetos compose e um nginx servindo `avexa.global`,
> `admin.avexa.global` e `admin-staging.avexa.global`. Por isso o motor de
> outreach instala em **`/opt/avexa-motor`**, com projeto compose
> `avexa-motor`, e nunca encosta em `/opt/avexa`.

O que o Avexa cria, e nada além disso:

| | |
| --- | --- |
| Usuário | `avexa` (no grupo `docker`) |
| Diretório | `/opt/avexa-motor` |
| Contêineres | `avexa-motor-postgres-1`, `avexa-motor-web-1`, `avexa-motor-worker-1` |
| Volumes | `avexa-motor_dados-pg` |
| Portas | **nenhuma** na internet no perfil `externo`; só `127.0.0.1:3001` |

O que ele **não** toca sem `--firewall` / `--fail2ban`: ufw, fail2ban, sshd,
nginx ou qualquer outro serviço que já esteja de pé.

## Quem roda o quê

O container onde o Claude trabalha **não alcança a porta 22**: o proxy do
ambiente aceita o `CONNECT` e derruba tudo que não é TLS (dá para comprovar
contra `github.com:22`, que responde banner na hora e ali fecha na cara). O
runner do GitHub alcança. Por isso existe o workflow **Servidor**
(`.github/workflows/servidor.yml`): ele é o terminal remoto, e cada ação sai no
log do job.

| Passo | Quem faz |
| --- | --- |
| Gerar a chave e cadastrar a pública no VPS | **você**, uma vez |
| Cadastrar os três secrets no GitHub | **você**, uma vez |
| Diagnóstico, bootstrap, deploy, logs, estado | pela aba Actions |

O primeiro passo não tem como ser de outra pessoa: é ele que concede o acesso,
e ninguém cria sozinho uma permissão que não tem.

## Olhar a máquina antes de mexer

Pelo workflow **Servidor › diagnostico** (ou, à mão, `bash diagnostico.sh`).
Não muda nada — só lê. Diz quem ocupa 80 e 443, o que já roda em Docker, o
estado do firewall e o que escuta fora do loopback. É a saída dele que decide o
perfil abaixo.

## Os dois perfis

| | `caddy` | `externo` |
| --- | --- | --- |
| Quando | 80 e 443 livres | já tem nginx, Traefik ou outro proxy servindo |
| TLS | o Caddy do Avexa pede o certificado | de quem já cuida |
| Portas públicas | 80 e 443 | nenhuma |
| Painel escuta | rede interna do Docker | `127.0.0.1:3001` |

O `bootstrap.sh` detecta e grava `PERFIL_PROXY` no `.env`. O deploy confere de
novo a cada execução: se o perfil disser `caddy` mas a 443 estiver ocupada, ele
**para e não sobe o Caddy** — entre o bootstrap e o deploy alguém pode ter
instalado um nginx, e subir em cima disso tira do ar o site que funcionava.

## Uma vez só

### 1. A chave, na sua máquina

```sh
ssh-keygen -t ed25519 -C 'deploy@avexa' -f ~/.ssh/avexa_deploy -N ''
```

A **privada** (`~/.ssh/avexa_deploy`) nunca sai da sua máquina, a não ser para o
secret do GitHub. Não cole em chat, não mande por e-mail, não ponha no servidor.

### 2. Dar o acesso

No console web da Hostinger (ou `ssh root@31.97.128.229`), uma linha:

```sh
mkdir -p ~/.ssh && echo "COLE_AQUI_A_CHAVE_PUBLICA" >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys
```

É só isto. O `bootstrap.sh` em si pode rodar pelo workflow **Servidor ›
bootstrap** com `usuario=root` — ele deriva a chave pública da privada que já
está no secret, cria o usuário `avexa` com essa mesma chave e nunca mais precisa
de root.

Depois que o bootstrap passar, **apague a chave do root** e deixe só a do
`avexa`: deploy não precisa de root, e chave de deploy no root transforma
qualquer vazamento em acesso total.

```sh
> ~/.ssh/authorized_keys   # como root, depois de conferir que o avexa funciona
```

Se preferir fazer tudo à mão, é o mesmo script:

```sh
bash bootstrap.sh "$(cat ~/.ssh/avexa_deploy.pub)"
```

Cria o usuário, os diretórios, o `.env` com `APP_SECRET` e senha de banco novos,
e instala o Docker **se não houver**. Pode rodar de novo quando quiser: nada é
refeito nem sobrescrito — em especial o `.env`, porque segredo sobrescrito é
integração quebrada em todos os clientes de uma vez.

> **Guarde uma cópia do `APP_SECRET`.** É a chave que cifra os refresh tokens de
> Google, Calendly e HubSpot em repouso. Perdê-la significa cada cliente
> reconectar tudo à mão.

Para ele também abrir 80/443 num ufw **que já esteja ativo**, acrescente
`--firewall`. Se o ufw estiver desligado, ele se recusa a ligar e mostra o que
está escutando — ligar firewall em máquina com serviço rodando é o jeito mais
rápido de derrubar algo que ninguém lembrava.

### 3. Secrets no GitHub

Em **Settings › Secrets and variables › Actions**:

| Nome | Valor |
| --- | --- |
| `VPS_HOST` | `31.97.128.229` |
| `VPS_USER` | `avexa` |
| `VPS_SSH_KEY` | conteúdo de `~/.ssh/avexa_deploy` (a privada, inteira, com `BEGIN`/`END`) |

O workflow usa um *environment* chamado `producao`, criado sozinho na primeira
execução. Não muda nada hoje; existe para o dia em que você quiser exigir
aprovação antes de um deploy.

### 4. DNS

```
app.avexa.global     A    31.97.128.229
hooks.avexa.global   A    31.97.128.229
```

## Atrás de um proxy que já existe (`PERFIL_PROXY=externo`)

O Avexa escuta em `127.0.0.1:3001`. Aponte o proxy da máquina para lá. Com
nginx, este trecho **foi testado** e entrega os caminhos certos:

```nginx
server {
  server_name app.avexa.global;
  location / {
    proxy_pass http://127.0.0.1:3001;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}

server {
  server_name hooks.avexa.global;
  # A URL que o cliente recebe é /v1/<cliente>/<fluxo>; a rota real é
  # /api/hooks/v1/<cliente>/<fluxo>. Sem esta reescrita, TODO lead dá 404 —
  # e ninguém descobre até o primeiro formulário disparar.
  location /v1/ {
    proxy_pass http://127.0.0.1:3001/api/hooks/v1/;
    proxy_set_header Host $host;
  }
  location /api/webhooks/ {
    proxy_pass http://127.0.0.1:3001/api/webhooks/;
    proxy_set_header Host $host;
  }
}
```

A barra no fim de `proxy_pass` é o que faz a reescrita funcionar. Sem ela o
caminho vai errado e o resultado é 404 em tudo.

## Cada deploy

Aba **Actions › Deploy › Run workflow**. Na primeira vez, marque **seed**.

O workflow roda typecheck e testes antes de tocar no servidor, envia por
`rsync`, constrói, migra, sobe e confere o painel **na porta de loopback** — a
verificação é do nosso contêiner, não do proxy de terceiros. Depois ele olha o
domínio público e, se não responder, avisa sem falhar: DNS e proxy alheio não
são responsabilidade do deploy.

## Ver o que está acontecendo lá

Sem abrir terminal, pelo workflow **Servidor**:

| Ação | O que mostra |
| --- | --- |
| `diagnostico` | portas, Docker, firewall, o que um firewall cortaria |
| `estado` | contêineres de pé, disco e memória |
| `logs` | últimas 200 linhas de `web`, `worker`, `postgres` ou `caddy` |

## Quando precisar mexer à mão

De `/opt/avexa-motor/app`, como `avexa`:

```sh
compose() { docker compose --env-file .env -f infra/docker-compose.prod.yml "$@"; }

compose ps                      # o que está de pé
compose logs -f worker          # o motor trabalhando
compose logs -f web             # o painel
bash infra/deploy-remoto.sh     # o mesmo deploy, sem depender do GitHub
compose restart worker          # depois de mexer no .env
```

Primeiro acesso ao painel, sem Resend configurado:

```sh
# O tsx vem da raiz: a imagem do worker não instala as dependências de apps/web.
compose run --rm -w /app/apps/web worker \
  /app/node_modules/.bin/tsx scripts/link-de-acesso.ts \
  rodrigo@platty.tech https://new.avexa.global
```

O link vale 15 minutos e funciona uma vez só.

## Backup

O que não pode ser perdido é o volume do Postgres — leads, execuções, supressão
e os segredos cifrados das integrações:

```sh
docker exec avexa-motor-postgres-1 pg_dump -U avexa avexa \
  | gzip > /opt/avexa-motor/backups/avexa-$(date +%F).sql.gz
```

Vale pôr no cron e mandar para fora da máquina. Backup que mora no mesmo disco
que o banco não é backup.

## Desfazer tudo

Se precisar tirar o Avexa da máquina sem tocar no resto:

```sh
cd /opt/avexa-motor/app
docker compose --env-file .env -f infra/docker-compose.prod.yml down   # sem -v: o banco fica
docker volume rm avexa-motor_dados-pg                                        # isto apaga os leads
rm -rf /opt/avexa-motor
deluser avexa
```

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
  CPU e RAM da máquina durante o deploy — e essa máquina é compartilhada. Se
  começar a atrapalhar o que já roda lá, o caminho é construir no runner e
  publicar no GHCR.
