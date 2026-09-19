#!/usr/bin/env bash
#
# O que roda NO servidor a cada deploy. Mora aqui, e não dentro do YAML do
# workflow, por dois motivos: heredoc indentado dentro de YAML é uma armadilha
# clássica (o terminador com espaço à frente não fecha nada), e assim dá para
# rodar o mesmo deploy à mão quando o GitHub estiver fora do ar.
#
#   bash /opt/avexa/app/infra/deploy-remoto.sh
set -euo pipefail

cd /opt/avexa/app

if [[ ! -f .env ]]; then
  echo "erro: /opt/avexa/app/.env não existe — rode o infra/bootstrap.sh antes" >&2
  exit 1
fi

compose() { docker compose --env-file .env -f infra/docker-compose.prod.yml "$@"; }

echo "==> construindo"
compose build

# Migração antes de subir o código novo. Schema atrasado com código novo é erro
# em produção; o caminho contrário — schema novo com código velho — as nossas
# migrações toleram, porque elas só acrescentam.
echo "==> migrando o banco"
compose run --rm worker pnpm db:migrate

echo "==> subindo"
compose up -d --remove-orphans

# Imagem órfã de build anterior enche o disco do VPS em poucas semanas.
docker image prune -f >/dev/null

compose ps
