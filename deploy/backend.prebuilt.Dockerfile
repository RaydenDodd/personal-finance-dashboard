# The artifact and runtime dependency image must use the same package-lock.json.
# Compile with the normal backend build on the development machine, then copy
# its architecture-independent bundle over a matching native ARM64 runtime.
ARG BACKEND_RUNTIME_BASE=letehaha/budget-tracker-be:latest
FROM ${BACKEND_RUNTIME_BASE}

LABEL org.opencontainers.image.source="https://github.com/RaydenDodd/personal-finance-dashboard"

WORKDIR /app/packages/backend
COPY --chown=nodejs:nodejs backend-dist/ ./dist/
COPY --chown=nodejs:nodejs migrations/ ./src/migrations/
USER nodejs
