#!/usr/bin/env bash
# Renovação do certificado de new.avexa.global.
#
# Escopo estreito de propósito: `--cert-name new.avexa.global` renova só o
# nosso. Um `certbot renew` sem escopo passaria também pelos certificados do
# outro produto que mora nesta máquina, e mexer neles não é nossa chamada.
#
# Roda sem root: quem tem acesso ao diretório do certbot é o contêiner, não o
# usuário. Por isso até o `readlink` acontece dentro de um contêiner — o
# usuário de deploy não tem (nem precisa de) leitura em /srv/avexa.
#
# O certbot só age quando faltam menos de 30 dias para vencer, então quase toda
# execução é um no-op barato.
set -euo pipefail

CERT=${CERT:-new.avexa.global}
CONF=${CONF:-/srv/avexa/nginx/certbot/conf}
WWW=${WWW:-/srv/avexa/nginx/certbot/www}

impressao() {
  docker run --rm -v "$CONF:/etc/letsencrypt" --entrypoint sh certbot/certbot -c \
    "readlink -f /etc/letsencrypt/live/$CERT/fullchain.pem 2>/dev/null || echo ausente"
}

antes=$(impressao)

docker run --rm \
  -v "$CONF:/etc/letsencrypt" \
  -v "$WWW:/var/www/certbot" \
  certbot/certbot renew --cert-name "$CERT" \
  --webroot -w /var/www/certbot --non-interactive --quiet

depois=$(impressao)

if [ "$antes" = "$depois" ]; then
  echo "$(date -Is) $CERT sem renovação pendente ($antes)"
  exit 0
fi

# O nginx só lê o certificado no arranque e no reload. Sem isto a renovação
# acontece no disco e o navegador continua vendo o certificado vencido.
proxy=$(docker ps --format '{{.Names}}' | grep -Ei 'nginx' | head -1)
if [ -z "$proxy" ]; then
  echo "$(date -Is) ERRO: $CERT renovado mas nenhum contêiner nginx encontrado" >&2
  exit 1
fi

if ! docker exec "$proxy" nginx -t; then
  echo "$(date -Is) ERRO: nginx -t falhou; NÃO recarregando" >&2
  exit 1
fi

docker exec "$proxy" nginx -s reload
echo "$(date -Is) $CERT renovado e nginx recarregado"
