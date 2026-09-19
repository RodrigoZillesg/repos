#!/usr/bin/env bash
# Backup do Postgres do Avexa.
#
# O que não pode ser perdido é isto: leads, execuções, supressão e os segredos
# cifrados das integrações. Perder o volume significa cada cliente reconectar
# Google, Calendly e HubSpot na mão.
#
# Roda sem root — o usuário de deploy está no grupo docker, que é o que basta.
# Toca apenas o contêiner do avexa-motor: o Postgres do outro produto que mora
# nesta máquina não entra aqui nem por engano, porque o nome do contêiner é
# procurado dentro do projeto compose avexa-motor.
set -euo pipefail

RAIZ=${RAIZ:-/opt/avexa-motor}
DESTINO=${DESTINO:-$RAIZ/backups}
MANTER_DIAS=${MANTER_DIAS:-14}

cd "$RAIZ/app"

# Nome do contêiner pelo projeto, não por um palpite: `docker compose ps` só
# enxerga o nosso projeto, então não há como acertar o banco do vizinho.
pg=$(docker compose --env-file .env -f infra/docker-compose.prod.yml ps -q postgres)
if [ -z "$pg" ]; then
  echo "$(date -Is) ERRO: contêiner postgres do avexa-motor não está em pé" >&2
  exit 1
fi

mkdir -p "$DESTINO"
arquivo="$DESTINO/avexa-$(date +%F-%H%M).sql.gz"
parcial="$arquivo.parcial"

# Escreve num arquivo parcial e só renomeia no fim. Um dump interrompido pela
# metade com nome de backup bom é pior que backup nenhum: a gente confia nele.
# `pipefail` garante que a falha do pg_dump não se perca atrás do gzip.
if ! docker exec -i "$pg" pg_dump -U avexa avexa | gzip > "$parcial"; then
  rm -f "$parcial"
  echo "$(date -Is) ERRO: pg_dump falhou; nada foi gravado" >&2
  exit 1
fi

# Um dump vazio passa pelo gzip sem reclamar. 1 KB é generoso e ainda pega o
# caso em que o pg_dump só cuspiu cabeçalho.
if [ "$(stat -c %s "$parcial")" -lt 1024 ]; then
  rm -f "$parcial"
  echo "$(date -Is) ERRO: dump suspeito de vazio; descartado" >&2
  exit 1
fi

mv "$parcial" "$arquivo"
echo "$(date -Is) backup em $arquivo ($(du -h "$arquivo" | cut -f1))"

# Disco cheio derruba o banco. A retenção é local; quem guarda para sempre é a
# cópia de fora, que ainda não existe — veja o README.
apagados=$(find "$DESTINO" -maxdepth 1 -name 'avexa-*.sql.gz' -mtime "+$MANTER_DIAS" -print -delete | wc -l)
[ "$apagados" -gt 0 ] && echo "$(date -Is) $apagados backup(s) com mais de $MANTER_DIAS dias apagados"

exit 0
