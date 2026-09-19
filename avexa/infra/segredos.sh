#!/usr/bin/env bash
# Grava credenciais de fornecedor no .env do servidor.
#
# Os valores entram pela ENTRADA PADRÃO, uma linha `CHAVE=valor` por vez, e
# nunca por argumento: argumento aparece em `ps` para qualquer usuário da
# máquina, e esta máquina é compartilhada. Nada é impresso — o log diz quais
# chaves mudaram, jamais o que elas valem.
#
#   printf 'RESEND_API_KEY=%s\n' "$CHAVE" | bash infra/segredos.sh
#
# Só mexe nas chaves recebidas. O que já está no .env e não veio na entrada
# fica exatamente como estava: APP_SECRET e POSTGRES_PASSWORD, em especial,
# nunca podem ser reescritos por engano — trocar APP_SECRET torna ilegível
# todo refresh token de Google, Calendly e HubSpot já gravado.
set -euo pipefail

ENV=${ENV:-/opt/avexa-motor/app/.env}
[[ -f "$ENV" ]] || { echo "erro: $ENV não existe" >&2; exit 1; }

# Estas são geradas uma vez e são a identidade do ambiente. Recusar é mais
# seguro que confiar em quem chamou.
INTOCAVEIS='^(APP_SECRET|POSTGRES_PASSWORD)$'

# O .env guarda segredo: 600 antes de escrever qualquer coisa nele.
chmod 600 "$ENV"

novo=$(mktemp); trap 'rm -f "$novo" "$pares"' EXIT
pares=$(mktemp)
chmod 600 "$novo" "$pares"

total=0
while IFS= read -r linha; do
  [[ -z "$linha" || "$linha" == \#* ]] && continue
  chave=${linha%%=*}
  valor=${linha#*=}

  if [[ ! "$chave" =~ ^[A-Z][A-Z0-9_]*$ ]]; then
    echo "erro: nome de chave inválido, ignorando" >&2
    continue
  fi
  if [[ "$chave" =~ $INTOCAVEIS ]]; then
    echo "recusado: $chave é gerada pelo bootstrap e não se sobrescreve" >&2
    continue
  fi
  # Vazio significa "não tenho esta credencial ainda": não apaga o que já está
  # configurado. Para limpar de verdade, edite o .env à mão.
  if [[ -z "$valor" ]]; then
    echo "pulado: $chave veio vazia"
    continue
  fi

  printf '%s\t%s\n' "$chave" "$valor" >> "$pares"
  total=$((total + 1))
done

if [[ "$total" -eq 0 ]]; then
  echo "nenhuma chave para gravar"
  exit 0
fi

# Reescreve as que já existem, na posição em que estão, para o arquivo
# continuar legível. O awk recebe os valores por arquivo, não por -v: -v
# passaria pela linha de comando.
awk -F'\t' '
  NR == FNR { valor[$1] = $2; next }
  {
    linha = $0
    if (linha ~ /^[A-Z][A-Z0-9_]*=/) {
      chave = linha; sub(/=.*/, "", chave)
      if (chave in valor) { print chave "=" valor[chave]; visto[chave] = 1; next }
    }
    print linha
  }
  END {
    primeira = 1
    for (k in valor) if (!(k in visto)) {
      if (primeira) { print ""; print "# Acrescentado pelo infra/segredos.sh"; primeira = 0 }
      print k "=" valor[k]
    }
  }
' "$pares" "$ENV" > "$novo"

# Um .env truncado derruba a aplicação inteira. Confere antes de trocar.
for guarda in APP_SECRET POSTGRES_PASSWORD DATABASE_URL DOMINIO; do
  if grep -q "^$guarda=" "$ENV" && ! grep -q "^$guarda=" "$novo"; then
    echo "erro: $guarda sumiu na reescrita; abortando sem tocar no .env" >&2
    exit 1
  fi
done

cp -a "$ENV" "$ENV.bak.$(date +%s)"
cat "$novo" > "$ENV"
chmod 600 "$ENV"

echo "$total chave(s) gravada(s):"
cut -f1 "$pares" | sed 's/^/  - /'
echo "cópia do anterior em $ENV.bak.*"
