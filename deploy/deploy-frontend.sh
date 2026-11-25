#!/bin/bash
if [ -z "${BASH_VERSION:-}" ]; then exec bash "$0" "$@"; fi
set -euo pipefail
# Use bash for a live tee log without masking the deployment's exit status.
cd "$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
umask 077
mkdir -p private/deploy-logs
log="private/deploy-logs/deploy-frontend-$(date -u +%Y%m%dT%H%M%SZ)-$.log"
# Outer process owns the pipeline and preserves both command and logging failures.
if [ "${1:-}" != "--logged" ]; then
  set +e
  bash "deploy/deploy-frontend.sh" --logged 2>&1 | tee "$log"
  statuses=("${PIPESTATUS[@]}")
  if [ "${statuses[0]}" -eq 0 ] && [ "${statuses[1]}" -eq 0 ]; then
    printf '\033[32mPASS: frontend deployed and healthy.\033[0m\n' | tee -a "$log"
    printf 'Log: %s\n' "$log"
    exit 0
  fi
  printf '\033[31mFAIL: frontend deployment did not complete successfully. DO NOT PROCEED.\033[0m\n' | tee -a "$log"
  printf 'Log: %s\n' "$log"
  exit 1
fi
set -x
exec 9>private/prebuilt-deploy.lock
flock -n 9 || { echo 'Another prebuilt deployment is running.' >&2; exit 1; }
git diff --quiet && git diff --cached --quiet || {
  echo 'Tracked local changes exist; review them before deploying.' >&2
  exit 1
}
git fetch origin dev
git merge --ff-only origin/dev
commit=$(git rev-parse HEAD)
test "$commit" = "$(git rev-parse origin/dev)" || { echo 'HEAD is not origin/dev.' >&2; exit 1; }
artifact="private/frontend-$commit"
test -f "$artifact/source-commit.txt" || { echo "Missing uploaded artifact: $artifact" >&2; exit 1; }
test "$(cat "$artifact/source-commit.txt")" = "$commit" || { echo 'Artifact commit mismatch.' >&2; exit 1; }
compose() { docker compose --env-file .env.pi.local -f docker-compose.pi.yml "$@"; }
compose config --quiet
service=frontend
image=personal-finance-dashboard-frontend
container=$(compose ps -q "$service")
test -n "$container" || { echo "No running $service container; use the initial deployment guide." >&2; exit 1; }
previous=$(docker inspect --format '{{.Image}}' "$container")
docker tag "$previous" "$image:previous"
sh deploy/build-prebuilt-frontend.sh "$artifact"
if ! compose up -d --no-deps --no-build --wait --wait-timeout 300 "$service"; then
  echo "Deployment failed. Previous image retained as $image:previous." >&2
  echo 'Inspect logs before rollback; an image rollback cannot reverse database migrations.' >&2
  exit 1
fi
compose ps
echo "Deployed $service from $commit; previous image retained as $image:previous."
