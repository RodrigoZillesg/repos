#!/usr/bin/env bash
#
# Prepara o VPS para receber o Avexa **sem mexer no que já está no ar**.
#
#   bash bootstrap.sh "ssh-ed25519 AAAA... deploy@avexa"
#
# O argumento é a CHAVE PÚBLICA de deploy. A privada fica na sua máquina e no
# secret do GitHub; ela nunca deve passar por aqui nem por chat nenhum.
#
# Regra deste script: ele só cria o que é nosso — usuário, diretórios, .env e,
# se faltar, o Docker. Firewall, fail2ban e sshd são estado global da máquina, e
# um servidor compartilhado é exatamente onde "ligar o firewall" derruba um
# serviço que ninguém lembrava que estava ali. Essas três coisas ele analisa e
# recomenda; mexer nelas exige --firewall e --fail2ban, explicitamente.
#
# É idempotente: rodar de novo não refaz nem sobrescreve nada.
set -euo pipefail

CHAVE_PUBLICA=""
MEXER_FIREWALL=0
MEXER_FAIL2BAN=0
USUARIO="${AVEXA_USER:-avexa}"
RAIZ="/opt/avexa-motor"
# Um domínio só, porque neste servidor o avexa.global já é de outro produto.
# Trocar depois é editar o .env e o server block do nginx — nada no código
# depende do nome.
DOMINIO="${AVEXA_DOMINIO:-new.avexa.global}"

for arg in "$@"; do
  case "$arg" in
    --firewall) MEXER_FIREWALL=1 ;;
    --fail2ban) MEXER_FAIL2BAN=1 ;;
    ssh-*) CHAVE_PUBLICA="$arg" ;;
    *) echo "argumento não reconhecido: $arg" >&2; exit 1 ;;
  esac
done

vermelho() { printf '\033[31m%s\033[0m\n' "$*"; }
amarelo()  { printf '\033[33m%s\033[0m\n' "$*"; }
verde()    { printf '\033[32m%s\033[0m\n' "$*"; }
passo()    { printf '\n\033[1m==> %s\033[0m\n' "$*"; }

[[ $EUID -eq 0 ]] || { vermelho "rode como root"; exit 1; }
if [[ -z "$CHAVE_PUBLICA" ]]; then
  vermelho "falta a chave pública de deploy como argumento."
  echo "Gere na SUA máquina, não aqui:"
  echo "  ssh-keygen -t ed25519 -C 'deploy@avexa' -f ~/.ssh/avexa_deploy"
  echo "e passe o conteúdo de ~/.ssh/avexa_deploy.pub como argumento."
  exit 1
fi
if [[ "$CHAVE_PUBLICA" == *"PRIVATE KEY"* ]]; then
  vermelho "isso é uma chave PRIVADA. Nunca ponha a privada no servidor."
  exit 1
fi

porta_ocupada() { ss -lntH "sport = :$1" 2>/dev/null | grep -q .; }
dono_da_porta() { ss -lntpH "sport = :$1" 2>/dev/null | awk '{print $NF}' | head -1; }

passo "O que já está nesta máquina"
if porta_ocupada 443 || porta_ocupada 80; then
  PERFIL_PROXY=externo
  amarelo "Porta 80/443 já ocupada:"
  porta_ocupada 80  && amarelo "   80  → $(dono_da_porta 80)"
  porta_ocupada 443 && amarelo "   443 → $(dono_da_porta 443)"
  amarelo "O Avexa vai subir SEM Caddy próprio, escutando só em 127.0.0.1."
  amarelo "Quem já cuida do TLS continua cuidando — não vou disputar a porta."
else
  PERFIL_PROXY=caddy
  verde "80 e 443 livres: o Caddy do Avexa pode cuidar do TLS."
fi
[[ -n "$(docker ps -aq --filter 'label=com.docker.compose.project=avexa' 2>/dev/null)" ]] &&
  amarelo "Já existem contêineres do projeto avexa — este bootstrap não os toca."

passo "Pacotes"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
# Só o que o deploy precisa. Nada de instalar servidor web: se já houver um,
# instalar outro é começar uma briga por porta.
apt-get install -y -qq ca-certificates curl gnupg rsync openssl >/dev/null
verde "ok"

passo "Docker"
if command -v docker >/dev/null && docker compose version >/dev/null 2>&1; then
  verde "já instalado ($(docker --version | awk '{print $3}' | tr -d ,)) — não mexo"
else
  amarelo "instalando Docker (é a única coisa global que este script instala)"
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin >/dev/null
  systemctl enable --now docker >/dev/null
  verde "docker $(docker --version | awk '{print $3}' | tr -d ,)"
fi

passo "Usuário de deploy: $USUARIO"
# Deploy não entra como root. O grupo docker já é acesso total à máquina, então
# isso não é segurança de verdade — é para o log dizer quem fez o quê, e para
# uma chave vazada não virar login de root direto.
if ! id -u "$USUARIO" >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" "$USUARIO" >/dev/null
  verde "criado"
else
  verde "já existia"
fi
usermod -aG docker "$USUARIO"

install -d -m 700 -o "$USUARIO" -g "$USUARIO" "/home/$USUARIO/.ssh"
touch "/home/$USUARIO/.ssh/authorized_keys"
if ! grep -qxF "$CHAVE_PUBLICA" "/home/$USUARIO/.ssh/authorized_keys"; then
  echo "$CHAVE_PUBLICA" >> "/home/$USUARIO/.ssh/authorized_keys"
  verde "chave de deploy cadastrada"
else
  verde "chave de deploy já estava cadastrada"
fi
chown "$USUARIO:$USUARIO" "/home/$USUARIO/.ssh/authorized_keys"
chmod 600 "/home/$USUARIO/.ssh/authorized_keys"

passo "Diretórios"
install -d -m 755 -o "$USUARIO" -g "$USUARIO" "$RAIZ" "$RAIZ/app" "$RAIZ/backups"
verde "$RAIZ — tudo do Avexa mora aqui e em lugar nenhum mais"

passo "Segredos da aplicação"
ENV="$RAIZ/app/.env"
if [[ -f "$ENV" ]]; then
  verde "$ENV já existe — não vou tocar. Segredo sobrescrito é integração quebrada."
  grep -q '^PERFIL_PROXY=' "$ENV" || {
    echo "PERFIL_PROXY=$PERFIL_PROXY" >> "$ENV"
    verde "acrescentei PERFIL_PROXY=$PERFIL_PROXY"
  }
else
  # APP_SECRET cifra os refresh tokens de Google, Calendly e HubSpot em repouso.
  # Trocar esta chave depois torna ilegível o que já está gravado, e cada
  # cliente precisa reconectar. Por isso ela nasce aqui e fica.
  APP_SECRET="$(openssl rand -hex 32)"
  POSTGRES_PASSWORD="$(openssl rand -hex 24)"
  umask 077
  cat > "$ENV" <<ENVFILE
# Gerado pelo bootstrap em $(date -Iseconds). Guarde uma cópia em lugar seguro:
# perder APP_SECRET significa cada cliente reconectar Google, Calendly e HubSpot.
APP_SECRET=$APP_SECRET

# Entra dentro da DATABASE_URL, então só hexadecimal: um @ ou um # numa senha
# trocada à mão quebra a URL de conexão de um jeito difícil de diagnosticar.
POSTGRES_PASSWORD=$POSTGRES_PASSWORD

# caddy  = o Avexa sobe o próprio Caddy e cuida do TLS (portas 80/443 livres).
# externo = já existe proxy nesta máquina; o Avexa escuta só em 127.0.0.1 e
#           quem já manda nas portas continua mandando.
PERFIL_PROXY=$PERFIL_PROXY
# Porta de loopback do painel. Só 127.0.0.1 — invisível da internet.
PORTA_WEB=3001
DOMINIO=$DOMINIO
ACME_EMAIL=dev@platty.tech

# Preencha conforme for contratando cada fornecedor. O que ficar vazio
# simplesmente não é usado: o canal é pulado e o motivo aparece no monitor.
RESEND_API_KEY=
# O nome da variável importa: o adaptador lê EMAIL_REMETENTE. O domínio
# precisa estar verificado no Resend, senão o envio é recusado.
EMAIL_REMETENTE="Avexa <contato@avexa.global>"

WHATSAPP_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=

TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_REMETENTE=
TWILIO_STATUS_CALLBACK=https://$DOMINIO/api/webhooks/twilio

VAPI_API_KEY=
VAPI_ASSISTANT_ID=
VAPI_PHONE_NUMBER_ID=

IA_PROVEDOR=gemini
GEMINI_API_KEY=
IA_MODELO=gemini-2.5-flash

GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=https://$DOMINIO/api/integracoes/google/retorno

CALENDLY_CLIENT_ID=
CALENDLY_CLIENT_SECRET=
CALENDLY_REDIRECT_URI=https://$DOMINIO/api/integracoes/calendly/retorno
CALENDLY_SIGNING_KEY=

HUBSPOT_CLIENT_ID=
HUBSPOT_CLIENT_SECRET=
HUBSPOT_REDIRECT_URI=https://$DOMINIO/api/integracoes/hubspot/retorno

HOOKS_BASE_URL=https://$DOMINIO/v1
WORKER_CONCORRENCIA=5
ENVFILE
  chown "$USUARIO:$USUARIO" "$ENV"
  chmod 600 "$ENV"
  verde "$ENV criado · PERFIL_PROXY=$PERFIL_PROXY"
fi

passo "Firewall"
if [[ $MEXER_FIREWALL -eq 1 ]]; then
  if ! command -v ufw >/dev/null; then
    apt-get install -y -qq ufw >/dev/null
  fi
  if ufw status 2>/dev/null | head -1 | grep -q inactive; then
    vermelho "O ufw está DESLIGADO nesta máquina e eu não vou ligar."
    echo "   Ligar um firewall num servidor que já roda coisas é o jeito mais"
    echo "   rápido de derrubar um serviço que ninguém lembrava. O que está"
    echo "   escutando fora do loopback agora:"
    ss -lntuH 2>/dev/null | awk '$5 !~ /^(127\.|\[::1\])/ {print "     " $1, $5, $NF}' | sort -u
    echo
    echo "   Se depois de olhar essa lista você quiser ligar, abra o que precisa"
    echo "   ANTES de habilitar:"
    echo "     ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw enable"
  else
    # Já está ligado: acrescentar regra é aditivo e não derruba nada.
    ufw allow 80/tcp >/dev/null
    ufw allow 443/tcp >/dev/null
    ufw allow 443/udp >/dev/null
    verde "ufw já estava ativo; abri 80 e 443 (aditivo, nada foi fechado)"
  fi
else
  amarelo "não mexi no firewall. Para eu abrir 80/443 num ufw JÁ ativo: --firewall"
  command -v ufw >/dev/null && amarelo "   estado atual: $(ufw status 2>/dev/null | head -1)"
fi

passo "fail2ban"
if [[ $MEXER_FAIL2BAN -eq 1 ]]; then
  apt-get install -y -qq fail2ban >/dev/null
  systemctl enable --now fail2ban >/dev/null
  verde "instalado e ativo"
else
  amarelo "não instalei. Ele começa a banir IP por falha de SSH, e num servidor"
  amarelo "compartilhado isso pode trancar um colega. Para instalar: --fail2ban"
fi

cat <<FIM

$(verde "Servidor pronto. Nada que já estava no ar foi tocado.")

Perfil escolhido: $(amarelo "PERFIL_PROXY=$PERFIL_PROXY")
FIM

if [[ "$PERFIL_PROXY" == externo ]]; then
cat <<FIM
   O Avexa vai escutar em 127.0.0.1:3001 e não publica mais nada. Aponte o proxy
   que já existe para lá — com o nginx, por exemplo:

     server {
       server_name $DOMINIO;
       # A URL que o cliente recebe é /v1/<cliente>/<fluxo>; a rota real é
       # /api/hooks/v1/<cliente>/<fluxo>. Sem esta reescrita, todo lead dá 404.
       location /v1/ { proxy_pass http://127.0.0.1:3001/api/hooks/v1/; proxy_set_header Host \$host; }
       location /     { proxy_pass http://127.0.0.1:3001;             proxy_set_header Host \$host; }
     }

FIM
fi

cat <<FIM
Próximos passos:

  1. No GitHub, em Settings > Secrets and variables > Actions:
       VPS_HOST     $(hostname -I | awk '{print $1}')
       VPS_USER     $USUARIO
       VPS_SSH_KEY  o conteúdo de ~/.ssh/avexa_deploy (a chave PRIVADA)

  2. Actions > Deploy > Run workflow, marcando "seed" na primeira vez.

FIM
