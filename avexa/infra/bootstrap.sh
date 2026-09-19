#!/usr/bin/env bash
#
# Prepara o VPS para receber o Avexa. Roda como root, uma vez, e pode rodar de
# novo sem estragar nada: tudo aqui é idempotente.
#
#   curl -fsSL https://raw.githubusercontent.com/<org>/<repo>/main/avexa/infra/bootstrap.sh \
#     | bash -s -- "ssh-ed25519 AAAA... deploy@avexa"
#
# ou, com o arquivo já no servidor:
#
#   bash bootstrap.sh "ssh-ed25519 AAAA... deploy@avexa"
#
# O argumento é a CHAVE PÚBLICA de deploy. A privada fica na sua máquina e no
# secret do GitHub; ela nunca deve passar por aqui nem por chat nenhum.
set -euo pipefail

CHAVE_PUBLICA="${1:-}"
USUARIO="${AVEXA_USER:-avexa}"
RAIZ="/opt/avexa"

vermelho() { printf '\033[31m%s\033[0m\n' "$*"; }
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
[[ "$CHAVE_PUBLICA" == ssh-* ]] || { vermelho "isso não parece uma chave pública (deve começar com ssh-)"; exit 1; }
if [[ "$CHAVE_PUBLICA" == *"PRIVATE KEY"* ]]; then
  vermelho "isso é uma chave PRIVADA. Nunca coloque a privada no servidor."
  exit 1
fi

passo "Pacotes do sistema"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq ca-certificates curl gnupg ufw fail2ban rsync >/dev/null

passo "Docker"
if ! command -v docker >/dev/null; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin >/dev/null
fi
systemctl enable --now docker >/dev/null
verde "docker $(docker --version | awk '{print $3}' | tr -d ,)"

passo "Usuário de deploy: $USUARIO"
# Deploy não entra como root. O grupo docker já é acesso total à máquina, então
# isso não é segurança de verdade — é para o log dizer quem fez o quê, e para
# uma chave vazada não virar login de root direto.
if ! id -u "$USUARIO" >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" "$USUARIO" >/dev/null
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

passo "Segredos da aplicação"
ENV="$RAIZ/app/.env"
if [[ -f "$ENV" ]]; then
  verde "$ENV já existe — não vou tocar. Segredo sobrescrito é integração quebrada."
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
ACME_EMAIL=dev@platty.tech

# Preencha conforme for contratando cada fornecedor. O que ficar vazio
# simplesmente não é usado: o canal é pulado e o motivo aparece no monitor.
RESEND_API_KEY=
RESEND_REMETENTE=

WHATSAPP_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=

TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_REMETENTE=
TWILIO_STATUS_CALLBACK=https://hooks.avexa.global/api/webhooks/twilio

VAPI_API_KEY=
VAPI_ASSISTANT_ID=
VAPI_PHONE_NUMBER_ID=

IA_PROVEDOR=gemini
GEMINI_API_KEY=
IA_MODELO=gemini-2.5-flash

GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=https://app.avexa.global/api/integracoes/google/retorno

CALENDLY_CLIENT_ID=
CALENDLY_CLIENT_SECRET=
CALENDLY_REDIRECT_URI=https://app.avexa.global/api/integracoes/calendly/retorno
CALENDLY_SIGNING_KEY=

HUBSPOT_CLIENT_ID=
HUBSPOT_CLIENT_SECRET=
HUBSPOT_REDIRECT_URI=https://app.avexa.global/api/integracoes/hubspot/retorno

HOOKS_BASE_URL=https://hooks.avexa.global/v1
WORKER_CONCORRENCIA=5
ENVFILE
  chown "$USUARIO:$USUARIO" "$ENV"
  chmod 600 "$ENV"
  verde "$ENV criado com APP_SECRET e senha de banco novos"
fi

passo "Firewall"
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw allow 443/udp >/dev/null
ufw --force enable >/dev/null
verde "$(ufw status | head -1) · 22, 80 e 443 abertas, o resto fechado"

passo "fail2ban"
systemctl enable --now fail2ban >/dev/null
verde "ativo"

cat <<FIM

$(verde "Servidor pronto.")

Próximos passos, na ordem:

  1. No GitHub, em Settings > Secrets and variables > Actions, cadastre:
       VPS_HOST     31.97.128.229
       VPS_USER     $USUARIO
       VPS_SSH_KEY  o conteúdo de ~/.ssh/avexa_deploy (a chave PRIVADA)

  2. Rode o workflow "Deploy" pela aba Actions.

  3. Depois do primeiro deploy, rode o seed uma vez:
       cd $RAIZ/app && docker compose --env-file .env -f infra/docker-compose.prod.yml \\
         run --rm worker pnpm db:seed

  4. Preencha $ENV com as credenciais dos fornecedores e reinicie:
       cd $RAIZ/app && docker compose --env-file .env -f infra/docker-compose.prod.yml up -d

$(vermelho "Recomendado, e não fiz por você:") desligar login por senha no SSH. Com
a chave já cadastrada e o console web da Hostinger como porta dos fundos, o
risco de se trancar do lado de fora é baixo — mas é a sua chamada:

  sed -i 's/^#*PermitRootLogin.*/PermitRootLogin prohibit-password/' /etc/ssh/sshd_config
  sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
  systemctl reload ssh

FIM
