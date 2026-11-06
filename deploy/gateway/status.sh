#!/bin/sh
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
docker compose --env-file .env.pi.local -f deploy/gateway/compose.yml ps
systemctl is-active caddy finance-ingress.service finance-gateway-backup.timer
for path in /authelia/ /personal-finance /api/v1/accounts /mcp; do
 code=$(curl -sS --resolve raydenfinance.duckdns.org:443:127.0.0.1 -o /dev/null -w '%{http_code}' "https://raydenfinance.duckdns.org$path")
 printf '%s %s\n' "$code" "$path"
done
# Expected active: portal200, application302/303, API401, MCP404.
