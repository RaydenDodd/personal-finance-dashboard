#!/bin/sh
set -eu
project_directory=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
artifact_directory=${1:?Usage: sh deploy/build-prebuilt-frontend.sh /path/to/artifact-context}
artifact_directory=$(CDPATH= cd -- "$artifact_directory" && pwd)
for required in frontend-dist/index.html nginx.conf docker-entrypoint.sh; do
  test -f "$artifact_directory/$required" || { echo "Missing artifact: $required" >&2; exit 1; }
done
docker build \
  --file "$project_directory/deploy/frontend.prebuilt.Dockerfile" \
  --tag personal-finance-dashboard-frontend:local \
  "$artifact_directory"
echo 'Frontend image ready. Use SKIP_BUILD=true sh deploy/deploy.sh to start it.'
