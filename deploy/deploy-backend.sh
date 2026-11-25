#!/bin/sh
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
mkdir -p private
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
artifact="private/backend-$commit"
test -f "$artifact/source-commit.txt" || { echo "Missing uploaded artifact: $artifact" >&2; exit 1; }
test "$(cat "$artifact/source-commit.txt")" = "$commit" || { echo 'Artifact commit mismatch.' >&2; exit 1; }
compose() { docker compose --env-file .env.pi.local -f docker-compose.pi.yml "$@"; }
compose config --quiet
service=backend
image=personal-finance-dashboard-backend
container=$(compose ps -q "$service")
test -n "$container" || { echo "No running $service container; use the initial deployment guide." >&2; exit 1; }
previous=$(docker inspect --format '{{.Image}}' "$container")
docker tag "$previous" "$image:previous"
compose run --rm --no-deps backup once
sh deploy/build-prebuilt-backend.sh "$artifact"
if ! compose up -d --no-deps --no-build --wait --wait-timeout 300 "$service"; then
  echo "Deployment failed. Previous image retained as $image:previous." >&2
  echo 'Inspect logs before rollback; an image rollback cannot reverse database migrations.' >&2
  exit 1
fi
compose exec -T frontend nginx -s reload
compose ps
echo "Deployed $service from $commit; previous image retained as $image:previous."
