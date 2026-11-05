#!/bin/sh
set -eu
project_directory=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
artifact_directory=${1:?Usage: sh deploy/build-prebuilt-backend.sh /path/to/artifact-context}
artifact_directory=$(CDPATH= cd -- "$artifact_directory" && pwd)
for required in backend-dist/app.js package-lock.json; do
  test -f "$artifact_directory/$required" || { echo "Missing artifact: $required" >&2; exit 1; }
done
test -d "$artifact_directory/migrations" || { echo 'Missing migrations artifact directory' >&2; exit 1; }
base_image=${BACKEND_RUNTIME_BASE:-personal-finance-dashboard-backend:dependencies-base}
if ! docker image inspect "$base_image" >/dev/null 2>&1; then
  if [ "$base_image" = personal-finance-dashboard-backend:dependencies-base ] &&
      docker image inspect personal-finance-dashboard-backend:local >/dev/null 2>&1; then
    docker tag personal-finance-dashboard-backend:local "$base_image"
  else
    echo 'Load a matching ARM64 runtime image, or set BACKEND_RUNTIME_BASE explicitly.' >&2
    exit 1
  fi
fi
artifact_hash=$(sha256sum "$artifact_directory/package-lock.json" | cut -d ' ' -f 1)
runtime_hash=$(docker run --rm --entrypoint sha256sum "$base_image" /app/package-lock.json | cut -d ' ' -f 1)
if [ "$artifact_hash" != "$runtime_hash" ]; then
  echo 'Artifact lockfile differs from runtime dependencies. Build or load a matching runtime first.' >&2
  exit 1
fi
docker build \
  --file "$project_directory/deploy/backend.prebuilt.Dockerfile" \
  --build-arg "BACKEND_RUNTIME_BASE=$base_image" \
  --tag personal-finance-dashboard-backend:local \
  "$artifact_directory"
echo 'Backend image ready. Use SKIP_BUILD=true sh deploy/deploy.sh to start it.'
