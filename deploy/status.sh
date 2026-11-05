#!/bin/sh
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
docker compose --env-file .env.pi.local -f docker-compose.pi.yml ps
docker compose --env-file .env.pi.local -f docker-compose.pi.yml exec -T backup sh -c 'find /backups -maxdepth 1 -name "finance-*.dump" -mtime -2 -print'
