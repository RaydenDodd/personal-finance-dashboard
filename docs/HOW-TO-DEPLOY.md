# How to deploy MoneyMatter

This guide applies to the customized Raspberry Pi deployment, not the upstream generic Docker setup. For installation, network configuration and recovery see [deploy/README.md](../deploy/README.md).

## Prerequisites

- Windows checkout on the current `origin/dev`, Node and installed npm dependencies.
- SSH alias `cardgames-pi`, Pi checkout `~/personal-finance-dashboard`, existing Compose stack and ignored `.env.pi.local`.
- Commit/push your intended code first. Preserve unrelated tracked changes and never reset a dirty checkout. Untracked notes are okay.
- Run only the component that changed (both if shared code, API contract or metadata requires both). Build on Windows because the Pi has previously struggled with source compilation.

## Recommended: automated scripts

In Windows PowerShell, from the repository root:

```powershell
git status
git switch dev
git pull --ff-only origin dev
# Frontend only:
.\deploy\build-frontend.ps1
# Backend only:
.\deploy\build-backend.ps1
```

By default both scripts use fast mode: compile, package and upload, with mandatory backend TypeScript checking (Vite alone does not check types) and the frontend build's existing Vue type check. Unit tests and backend lint-rule tests are skipped in fast mode. Use `-Test` to run new or modified unit tests since the last successfully tested component commit (`private/last-tested-<component>.txt`), or `-TestBase <commit>` for an explicit comparison base. First targeted run defaults to `HEAD^`. Use `-TestPattern <pattern>` for a Jest regex or Vitest filename filter, or `-FullTests` for the full unit suite and backend lint-rule checks. Failed selected checks block packaging. Fast mode and zero-test or explicit-pattern runs do not advance the tested marker. Full-suite testing with isolated dependencies and e2e/migration validation remain recommended for major releases. Every native command, packaging and overall build duration is printed; `-TraceCommands` restores verbose PowerShell tracing. Pi deployments retain the database backup and health checks in all modes.

```powershell
.\deploy\build-backend.ps1 -Test
.\deploy\build-backend.ps1 -TestBase f72f553
.\deploy\build-backend.ps1 -TestPattern 'read-model'
.\deploy\build-backend.ps1 -FullTests
.\deploy\build-frontend.ps1 -FullTests
```

Both build scripts check tracked cleanliness and exact origin/dev identity, package into `private/<component>-<full-commit>`, compress to a single tar.gz, stage/upload over SCP, verify SHA-256, extract and publish without overwriting existing artifacts, and report success/failure. `-NoUpload` leaves a local package only; `-SshHost` overrides the default alias. An already published artifact for the same commit is not overwritten. Reuse it if verified or remove it only when no deployment is using it.

Automated SSH commands disable stdin and terminal allocation (`-n -T`); SSH and SCP both use batch authentication, a 10-second connection timeout and server keepalives (10 seconds, three unanswered probes). Configure a trusted host key and working SSH key/agent in advance. If upload stalls at the first SSH command and resumes on Enter, verify `ssh.exe -n -T -o BatchMode=yes -o ConnectTimeout=10 cardgames-pi "echo SSH_OK"` from the same PowerShell session. If the updated script still pauses, check classic Windows Console QuickEdit/selection mode or try Windows Terminal. The keepalives detect an unresponsive SSH peer, not a slow remote command; no overall transfer deadline is imposed.

On green PASS, SSH into the Pi:

```powershell
ssh cardgames-pi
```

```sh
cd ~/personal-finance-dashboard
git pull --ff-only origin dev
# Frontend only:
sh deploy/deploy-frontend.sh
# Backend only:
sh deploy/deploy-backend.sh
```

The deployment scripts lock against overlapping scripted deployments, require matching source-commit artifacts, tag the running image as `:previous`, build with the existing prebuilt helpers, restart only the selected service and wait for health checks. Backend also takes a successful database backup and reloads nginx. A green result means the selected deployment/health check succeeded, not that every business feature has been tested. A red result means stop and inspect the error. The scripts print commands and responses and write logs under `private/deploy-logs/` on the machine running them. Review logs for sensitive information before sharing.

## Manual mode: frontend

Windows PowerShell, from the root, with the intended commit checked out:

```powershell
npm run test:unit -w packages/frontend -- --run
npm run build -w packages/frontend
```

Stop on a failed command. Use a new empty artifact directory to prevent stale assets; the example uses a timestamp.

```powershell
$artifact = "private/manual-frontend-$(Get-Date -Format yyyyMMdd-HHmmss)"
New-Item -ItemType Directory -Force "$artifact/frontend-dist" | Out-Null
Copy-Item packages/frontend/dist/* "$artifact/frontend-dist" -Recurse -Force
Copy-Item packages/frontend/nginx.conf "$artifact/nginx.conf" -Force
$entry = Get-Content self-hosting/frontend/docker-entrypoint.sh -Raw
[IO.File]::WriteAllText((Join-Path $PWD "$artifact/docker-entrypoint.sh"), $entry.Replace("`r`n", "`n"), [Text.UTF8Encoding]::new($false))
git rev-parse HEAD
scp -r $artifact cardgames-pi:personal-finance-dashboard/private/
```

Note the artifact folder printed by your terminal (`$artifact`) and commit SHA. On the Pi (replace the example folder with that exact name):

```sh
cd ~/personal-finance-dashboard
git pull --ff-only origin dev
git log -1 --oneline
# Verify this matches the Windows build before continuing.
docker tag personal-finance-dashboard-frontend:local personal-finance-dashboard-frontend:previous
sh deploy/build-prebuilt-frontend.sh private/manual-frontend-YYYYMMDD-HHMMSS
docker compose --env-file .env.pi.local -f docker-compose.pi.yml up -d --no-deps --no-build --wait frontend
sh deploy/status.sh
```

Frontend deploys do not require a database backup because they do not migrate or restart PostgreSQL.

## Manual mode: backend

Windows PowerShell:

```powershell
npm run typecheck -w packages/backend
npm run test:lint-rules -w packages/backend
npm run test:unit -w packages/backend -- --testMatch "**/*.unit.ts" --passWithNoTests=false --runInBand
npm run build -w packages/backend
```

Stop on any failure. For focused tests add `--testPathPattern="pattern"`. The default Jest configuration has previously discovered zero tests on Windows; the override above worked for the MCP investment tests.

```powershell
$artifact = "private/manual-backend-$(Get-Date -Format yyyyMMdd-HHmmss)"
New-Item -ItemType Directory -Force "$artifact/backend-dist" | Out-Null
New-Item -ItemType Directory -Force "$artifact/migrations" | Out-Null
Copy-Item packages/backend/dist/* "$artifact/backend-dist" -Recurse -Force
Copy-Item packages/backend/src/migrations/* "$artifact/migrations" -Recurse -Force
Copy-Item package-lock.json "$artifact/package-lock.json" -Force
git rev-parse HEAD
scp -r $artifact cardgames-pi:personal-finance-dashboard/private/
```

On the Pi:

```sh
cd ~/personal-finance-dashboard
git pull --ff-only origin dev
git log -1 --oneline
# Verify the build commit matches.
docker compose --env-file .env.pi.local -f docker-compose.pi.yml run --rm --no-deps backup once
# Continue only after the backup succeeds.
docker tag personal-finance-dashboard-backend:local personal-finance-dashboard-backend:previous
sh deploy/build-prebuilt-backend.sh private/manual-backend-YYYYMMDD-HHMMSS
docker compose --env-file .env.pi.local -f docker-compose.pi.yml up -d --no-deps --no-build --wait backend
docker exec personal-finance-dashboard-frontend-1 nginx -s reload
sh deploy/status.sh
```

The runtime helper compares the artifact lockfile with the installed ARM64 dependencies. If they differ, do not bypass it: build/load a matching ARM64 dependency image as explained in [Pi deployment](../deploy/README.md#updates-and-rollback). Manual commands do not share the scripted deployment lock; avoid concurrent deployments.

## Verify and troubleshoot

```sh
sh deploy/status.sh
docker compose --env-file .env.pi.local -f docker-compose.pi.yml logs --tail 100 backend
docker exec personal-finance-dashboard-backend-1 printenv MCP_READ_ONLY
```

Expected: all six finance services healthy; MCP_READ_ONLY is false when the owner has enabled writes in Compose. Check the website, relevant page and a bounded read-only API/UI smoke test. For MCP reconnect with the required investment/read/write scopes and verify the actual client tool list; healthy Docker containers do not prove ChatGPT discovery. See [MCP instructions](../deploy/README.md#authenticated-mcp).

If the Pi emits the previously observed cgroup memory-limit warning, note that Docker memory ceilings are not enforced until host configuration is corrected; do not assume that source builds or large analytics queries are safe.

## Backups and rollback

PostgreSQL backups are in `private/backups/` and the scheduled backup service retains 30 days. A backend deployment requires a successful fresh dump. Each selected service preserves one previous image tag. Backups do not include attachments or the separate environment/encryption secrets; maintain protected copies of those too.

If a deploy fails, preserve logs and backup first. For an image-only rollback **only after confirming no incompatible migration was applied**:

```sh
# Select backend or frontend; example backend:
docker tag personal-finance-dashboard-backend:previous personal-finance-dashboard-backend:local
docker compose --env-file .env.pi.local -f docker-compose.pi.yml up -d --no-deps --no-build --wait backend
docker exec personal-finance-dashboard-frontend-1 nginx -s reload
sh deploy/status.sh
```

An image rollback cannot reverse database migrations. Restore a matching backup into a separate database for verification before any production recovery. Never run `docker compose down -v`, delete volumes, or overwrite the live database as a routine deployment or troubleshooting step.
