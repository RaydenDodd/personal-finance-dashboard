#!/bin/sh
# Run on the deployment host. Secrets are generated there and never printed.
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
umask 077
if [ -e .env.pi.local ]; then
  echo 'Existing .env.pi.local preserved.'
  exit
fi
command -v openssl >/dev/null || { echo 'openssl is required to generate secrets.' >&2; exit 1; }
finance_port=${FINANCE_PORT:-8095}
case "$finance_port" in
  ''|*[!0-9]*) echo 'FINANCE_PORT must be a port number.' >&2; exit 1 ;;
esac
if [ "$finance_port" -lt 1024 ] || [ "$finance_port" -gt 65535 ]; then
  echo 'FINANCE_PORT must be between 1024 and 65535.' >&2
  exit 1
fi
origin=${FINANCE_ORIGIN:-http://localhost:$finance_port}
case "$origin" in
  http://localhost:*|http://127.0.0.1:*|http://192.168.0.32:*|https://*) ;;
  *) echo 'Set FINANCE_ORIGIN to your localhost, private Pi, or HTTPS origin.' >&2; exit 1 ;;
esac
secret() { openssl rand -hex 32; }
temporary=.env.pi.local.tmp
trap 'rm -f .env.pi.local.tmp' EXIT HUP INT TERM
cat > "$temporary" <<EOF
NODE_ENV=production
FINANCE_BIND_IP=127.0.0.1
FINANCE_PORT=$finance_port
FINANCE_UID=$(id -u)
FINANCE_GID=$(id -g)
BETTER_AUTH_URL=$origin
AUTH_ORIGIN=$origin
ALLOWED_ORIGINS=$origin
AUTH_RP_ID=localhost
AUTH_RP_NAME=MoneyMatter
MCP_BASE_URL=$origin
APPLICATION_HOST=0.0.0.0
APPLICATION_PORT=8081
APPLICATION_JWT_SECRET=$(secret)
APP_SESSION_ID_SECRET=$(secret)
BETTER_AUTH_SECRET=$(secret)
APPLICATION_DB_HOST=db
APPLICATION_DB_PORT=5432
APPLICATION_DB_USERNAME=finance
APPLICATION_DB_PASSWORD=$(secret)
APPLICATION_DB_DATABASE=finance
APPLICATION_DB_DIALECT=postgres
APPLICATION_REDIS_HOST=redis
CURRENCY_RATES_API_URL=http://currency-rates-api:8080
DB_QUERY_LOGGING=false
I18N_LOGGING=false
IS_SELF_HOST=true
SYSTEM_DEMO_DISABLED=true
SYSTEM_MAX_SIGNUPS_ALLOWED=1
MCP_READ_ONLY=true
NODE_BUILD_HEAP_MB=2048
EOF
chmod 600 "$temporary"
mv "$temporary" .env.pi.local
mkdir -p private/backups
chmod 700 private private/backups
echo "Created private local configuration. Default binding is 127.0.0.1:$finance_port."
