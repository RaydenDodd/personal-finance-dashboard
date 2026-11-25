#!/bin/bash
if [ -z "${BASH_VERSION:-}" ]; then exec bash "$0" "$@"; fi
set -euo pipefail
# Use bash for a live tee log without masking the deployment's exit status.
cd "$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
umask 077
mkdir -p private/deploy-logs
log="private/deploy-logs/deploy-backend-$(date -u +%Y%m%dT%H%M%SZ)-$.log"
# Outer process owns the pipeline and preserves both command and logging failures.
if [ "${1:-}" != "--logged" ]; then
  set +e
  bash "deploy/deploy-backend.sh" --logged 2>&1 | tee "$log"
  statuses=("${PIPESTATUS[@]}")
  if [ "${statuses[0]}" -eq 0 ] && [ "${statuses[1]}" -eq 0 ]; then
    printf '\033[32mPASS: backend deployed and healthy.\033[0m\n' | tee -a "$log"
    printf 'Log: %s\n' "$log"
    exit 0
  fi
  printf '\033[31mFAIL: backend deployment did not complete successfully. DO NOT PROCEED.\033[0m\n' | tee -a "$log"
  printf 'Log: %s\n' "$log"
  exit 1
fi
start_seconds=$SECONDS
trap 'printf "Total deployment elapsed: %ss\\n" "$((SECONDS-start_seconds))"' EXIT
set -x
exec 9>private/prebuilt-deploy.lock
flock -n 9 || { echo 'Another prebuilt deployment is running.' >&2; exit 1; }
git diff --quiet && git diff --cached --quiet || {
  echo 'Tracked local changes exist; review them before deploying.' >&2
  exit 1
}
previous_head=$(git rev-parse HEAD)
git fetch origin dev
git merge --ff-only origin/dev
commit=$(git rev-parse HEAD)
# Bash may still be executing the previous version of this script after merge.
# Restart from the updated file before deploying any new topology.
if [ "$previous_head" != "$commit" ]; then
  exec 9>&-
  exec bash deploy/deploy-backend.sh --logged
fi
test "$commit" = "$(git rev-parse origin/dev)" || { echo 'HEAD is not origin/dev.' >&2; exit 1; }
artifact="private/backend-$commit"
test -f "$artifact/source-commit.txt" || { echo "Missing uploaded artifact: $artifact" >&2; exit 1; }
test "$(cat "$artifact/source-commit.txt")" = "$commit" || { echo 'Artifact commit mismatch.' >&2; exit 1; }
compose() { docker compose --env-file .env.pi.local -f docker-compose.pi.yml "$@"; }
compose config --quiet
test -f "$artifact/backend-dist/investment-worker.js" || { echo 'Missing investment worker bundle; rebuild and upload backend.' >&2; exit 1; }
service=backend
image=personal-finance-dashboard-backend
container=$(compose ps -q "$service")
test -n "$container" || { echo "No running $service container; use the initial deployment guide." >&2; exit 1; }
previous=$(docker inspect --format '{{.Image}}' "$container")
docker tag "$previous" "$image:previous"
time compose run --rm --no-deps backup once
# Stop old worker before changing the shared backend image or running migrations.
if [ -n "$(compose ps -a -q investment-worker)" ]; then
  compose stop investment-worker
fi
time sh deploy/build-prebuilt-backend.sh "$artifact"
if ! time compose up -d --no-deps --no-build --wait --wait-timeout 300 "$service"; then
  echo "Deployment failed. Previous image retained as $image:previous." >&2
  echo 'Inspect logs before rollback; an image rollback cannot reverse database migrations.' >&2
  exit 1
fi
if ! time compose up -d --no-deps --no-build --wait --wait-timeout 300 investment-worker; then
  echo 'Analytics worker deployment failed. Inspect worker logs before proceeding.' >&2
  exit 1
fi
test -n "$(compose ps -q investment-worker)" || { echo 'Investment worker is not running.' >&2; exit 1; }
compose exec -T frontend nginx -s reload
compose ps
echo "Deployed $service from $commit; previous image retained as $image:previous."
