#!/usr/bin/env bash
#
# O que roda NO servidor a cada deploy. Mora aqui, e não dentro do YAML do
# workflow, por dois motivos: heredoc indentado dentro de YAML é uma armadilha
# clássica (o terminador com espaço à frente não fecha nada), e assim dá para
# rodar o mesmo deploy à mão quando o GitHub estiver fora do ar.
#
#   bash /opt/avexa/app/infra/deploy-remoto.sh
#
# Nada aqui toca em contêiner, imagem, volume ou porta que não seja do projeto
# `avexa`. A máquina pode estar servindo outras coisas.
set -euo pipefail

cd /opt/avexa/app

if [[ ! -f .env ]]; then
  echo "erro: /opt/avexa/app/.env não existe — rode o infra/bootstrap.sh antes" >&2
  exit 1
fi

# shellcheck disable=SC1091
PERFIL_PROXY="$(grep -E '^PERFIL_PROXY=' .env | cut -d= -f2- | tr -d '"' || true)"
PERFIL_PROXY="${PERFIL_PROXY:-externo}"
PORTA_WEB="$(grep -E '^PORTA_WEB=' .env | cut -d= -f2- | tr -d '"' || true)"
PORTA_WEB="${PORTA_WEB:-3001}"

ARQUIVOS=(-f infra/docker-compose.prod.yml)
if [[ "$PERFIL_PROXY" == caddy ]]; then
  # O bootstrap viu 80 e 443 livres, mas isso foi antes. Entre aquele momento e
  # agora alguém pode ter posto um nginx de pé — e subir o nosso Caddy em cima
  # disso tira do ar o site que está funcionando. Confere de novo, toda vez.
  nosso_caddy="$(docker ps -q \
    --filter 'label=com.docker.compose.project=avexa' \
    --filter 'name=caddy' 2>/dev/null)"
  if [[ -z "$nosso_caddy" ]] && ss -lntH 'sport = :443' 2>/dev/null | grep -q .; then
    echo "erro: PERFIL_PROXY=caddy, mas a porta 443 já está ocupada:" >&2
    ss -lntpH 'sport = :443' 2>/dev/null | sed 's/^/       /' >&2
    echo "       Não vou disputar a porta com quem já está servindo." >&2
    echo "       Troque para PERFIL_PROXY=externo no .env e aponte esse proxy" >&2
    echo "       para 127.0.0.1:$PORTA_WEB (instruções em infra/README.md)." >&2
    exit 1
  fi
  ARQUIVOS+=(-f infra/docker-compose.caddy.yml)
fi

compose() { docker compose --env-file .env "${ARQUIVOS[@]}" "$@"; }

echo "==> perfil: $PERFIL_PROXY · painel em 127.0.0.1:$PORTA_WEB"

echo "==> construindo"
compose build

# Migração antes de subir o código novo. Schema atrasado com código novo é erro
# em produção; o caminho contrário — schema novo com código velho — as nossas
# migrações toleram, porque elas só acrescentam.
echo "==> migrando o banco"
compose run --rm worker pnpm db:migrate

echo "==> subindo"
# --remove-orphans age só dentro do projeto `avexa`; contêiner de outro projeto
# não é órfão nosso.
compose up -d --remove-orphans

# Limpeza restrita ao que nós construímos. `docker image prune` sem filtro
# apagaria camadas soltas de outros projetos da máquina.
docker image prune -f --filter 'label=projeto=avexa' >/dev/null 2>&1 || true

compose ps

echo "==> conferindo o painel por dentro"
for i in $(seq 1 15); do
  codigo=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORTA_WEB/entrar" || true)
  if [[ "$codigo" == "200" ]]; then
    echo "painel respondendo em 127.0.0.1:$PORTA_WEB (HTTP 200)"
    exit 0
  fi
  echo "   tentativa $i: HTTP $codigo"
  sleep 4
done

echo "erro: o painel não respondeu em 127.0.0.1:$PORTA_WEB" >&2
compose logs --tail 60 web
exit 1
