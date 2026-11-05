#!/bin/sh
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
sh deploy/initialize.sh
docker compose version >/dev/null
compose() { docker compose --env-file .env.pi.local -f docker-compose.pi.yml "$@"; }
compose config --quiet
if compose ps --status running -q db | grep -q .; then
  # Require a fresh, validated backup before migrations run on an existing DB.
  compose run --rm --no-deps backup once
fi
# Sequential builds keep memory pressure lower on a Pi with other services.
if [ "${SKIP_BUILD:-false}" != true ]; then
  if [ -r /proc/meminfo ]; then
    available_kb=$(awk '/MemAvailable:/ {print $2}' /proc/meminfo)
    if [ "$available_kb" -lt 3145728 ]; then
      echo 'Source builds require at least 3 GB available RAM to protect existing services.' >&2
      echo 'Build artifacts on the development machine, use deploy/build-prebuilt-*.sh, then SKIP_BUILD=true.' >&2
      exit 1
    fi
  fi
  compose build backend
  compose build frontend
fi
compose up -d --wait --wait-timeout 300
compose ps
echo 'MoneyMatter is running. See deploy/README.md for local/VPN access and recovery.'
