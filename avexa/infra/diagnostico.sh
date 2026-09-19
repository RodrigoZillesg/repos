#!/usr/bin/env bash
#
# Olha o servidor e não toca em nada. Nenhum apt, nenhum systemctl, nenhum
# docker run — só leitura.
#
#   bash diagnostico.sh
#
# Rode isto ANTES do bootstrap e me mande a saída. Ela responde as perguntas
# que decidem se o Avexa pode subir sem atrapalhar o que já está no ar:
# quem ocupa 80 e 443, se o firewall está ligado, e o que já roda em Docker.
set -uo pipefail

titulo() { printf '\n\033[1m── %s\033[0m\n' "$*"; }
nota()   { printf '   %s\n' "$*"; }

titulo "Sistema"
nota "$(. /etc/os-release 2>/dev/null && echo "$PRETTY_NAME")"
nota "kernel $(uname -r) · uptime$(uptime -p | sed 's/^up//')"
nota "CPU: $(nproc) núcleo(s) · RAM: $(free -h | awk '/^Mem:/ {print $3 " de " $2 " em uso"}')"
nota "Disco: $(df -h / | awk 'NR==2 {print $3 " de " $2 " em uso (" $5 ")"}')"

titulo "Docker"
if command -v docker >/dev/null; then
  nota "$(docker --version)"
  nota "$(docker compose version 2>/dev/null || echo 'plugin compose NÃO instalado')"
  echo
  nota "Contêineres de pé:"
  docker ps --format '   {{.Names}}\t{{.Image}}\t{{.Ports}}' 2>/dev/null | sed 's/^/   /' || nota "   (sem permissão para listar)"
  echo
  nota "Projetos compose existentes:"
  docker ps -a --format '{{.Label "com.docker.compose.project"}}' 2>/dev/null \
    | grep -v '^$' | sort -u | sed 's/^/     /' || nota "     (nenhum)"
  echo
  nota "Volumes (o que tem dado dentro):"
  docker volume ls --format '     {{.Name}}' 2>/dev/null | head -30
else
  nota "Docker NÃO está instalado."
fi

titulo "Quem está ouvindo nas portas que nos interessam"
for porta in 80 443 22 3000 3001 5432 5678; do
  dono=$(ss -lntpH "sport = :$porta" 2>/dev/null | awk '{print $NF}' | head -1)
  if [[ -n "$dono" ]]; then
    printf '   %-6s OCUPADA  %s\n' "$porta" "$dono"
  else
    printf '   %-6s livre\n' "$porta"
  fi
done
echo
nota "Tudo que escuta fora do loopback (é isto que um firewall pode cortar):"
ss -lntuH 2>/dev/null | awk '$5 !~ /^(127\.|\[::1\])/ {print "     " $1, $5, $NF}' | sort -u | head -30

titulo "Servidor web já instalado"
for s in nginx apache2 caddy traefik haproxy; do
  if systemctl is-active --quiet "$s" 2>/dev/null; then
    nota "$s ATIVO (systemd)"
  elif command -v "$s" >/dev/null; then
    nota "$s instalado, mas parado"
  fi
done
docker ps --format '{{.Image}} {{.Names}}' 2>/dev/null \
  | grep -Ei 'nginx|caddy|traefik|haproxy' | sed 's/^/   em contêiner: /'

titulo "Firewall"
if command -v ufw >/dev/null; then
  estado=$(ufw status 2>/dev/null | head -1)
  nota "${estado:-ufw presente, sem permissão para ler}"
  ufw status numbered 2>/dev/null | sed -n '2,20p' | sed 's/^/     /'
else
  nota "ufw não instalado"
fi
if command -v iptables >/dev/null; then
  nota "regras iptables na cadeia INPUT: $(iptables -S INPUT 2>/dev/null | wc -l)"
fi

titulo "Já existe algo chamado avexa?"
id avexa >/dev/null 2>&1 && nota "usuário avexa EXISTE" || nota "usuário avexa não existe"
[[ -e /opt/avexa ]] && nota "/opt/avexa EXISTE — conteúdo: $(ls -A /opt/avexa 2>/dev/null | tr '\n' ' ')" || nota "/opt/avexa não existe"
docker ps -a --filter 'label=com.docker.compose.project=avexa' --format '   {{.Names}}' 2>/dev/null | grep . \
  && nota "^ já há contêineres do projeto avexa" || nota "nenhum contêiner do projeto avexa"

titulo "Resumo"
if ss -lntH 'sport = :443' 2>/dev/null | grep -q .; then
  nota "A porta 443 está OCUPADA → o Avexa deve subir SEM o Caddy dele,"
  nota "atrás do proxy que já existe. Perfil: PERFIL_PROXY=externo"
else
  nota "A porta 443 está livre → o Caddy do Avexa pode cuidar do TLS."
  nota "Perfil: PERFIL_PROXY=caddy"
fi
echo
