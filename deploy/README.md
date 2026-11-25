# Raspberry Pi deployment and recovery

For the current routine Windows/Pi workflow, see [How to deploy](../docs/HOW-TO-DEPLOY.md). For read-only inspection, see [How to view the database](../docs/HOW-TO-VIEW-DATABASE.md). This document retains the initial setup, infrastructure and recovery details; older localhost-only MCP examples are historical and must not replace an existing protected HTTPS/OAuth configuration.

The custom stack uses MoneyMatter's existing frontend, backend, PostgreSQL,
Redis, currency service, authentication, SimpleFIN and MCP server. It builds
the fork's source with the upstream Dockerfiles. All images support 64-bit
ARM Linux. The Pi needs Docker with Compose v2+; no existing service, proxy,
WireGuard configuration, or Docker container needs replacing.

## First start

From this checkout on the Pi:

```sh
sh deploy/deploy.sh
```

This creates `.env.pi.local` with fresh random secrets and mode 600, builds
one app image at a time, starts only the `personal-finance-dashboard` Compose
project, and waits for health checks. PostgreSQL migrations run through the
upstream entrypoint. The private network is `172.29.31.0/24`; change both the
Compose subnet and nginx gateway allowance if that conflicts on another host.
No bank provider or paid service is enabled. The single-account registration
limit protects the private instance after the first account is created.

The initial binding is **127.0.0.1:8095**. From Windows, open an SSH tunnel:

```powershell
ssh -N -L 8095:127.0.0.1:8095 cardgames-pi
```

Open `http://localhost:8095`, register the owner account, and keep that password
in your password manager. The tunnel encrypts all transport. No credentials
are stored in Git. Passkeys require HTTPS or a browser's localhost secure
context; email/password authentication works on the private HTTP origin.

## Existing LAN and WireGuard access

After claiming the owner account, edit these values in `.env.pi.local`:

```dotenv
FINANCE_BIND_IP=192.168.0.32
FINANCE_PORT=8095
BETTER_AUTH_URL=http://localhost:8095
AUTH_ORIGIN=http://localhost:8095
ALLOWED_ORIGINS=http://localhost:8095,http://localhost:8110,http://192.168.0.32:8095
MCP_BASE_URL=http://localhost:8095
AUTH_RP_ID=localhost
```

Recreate only this stack with the changed origin:

```sh
docker compose --env-file .env.pi.local -f docker-compose.pi.yml up -d --wait
```

The dashboard is then `http://192.168.0.32:8095`. The canonical OAuth origin stays
localhost for native MCP clients that require HTTPS or loopback HTTP metadata;
the explicit LAN allowed origin preserves normal email/password sign-in there.
For the final LAN binding, the encrypted tunnel command is
`ssh -N -L 8095:192.168.0.32:8095 cardgames-pi`.
Nginx permits only the existing
`192.168.0.0/24` LAN, `10.192.80.0/24` WireGuard subnet, loopback and this
stack's host gateway. Binding to the Pi's IPv4 LAN address avoids wildcard
IPv6 exposure. Database, Redis, and backend have no host-published ports.
The existing host firewall is unchanged. Do not add router port forwarding.
WireGuard encrypts remote traffic to the Pi; local LAN HTTP remains unencrypted.
Use the SSH tunnel or an existing private HTTPS proxy if LAN encryption is
required. This stack does not install or replace that proxy.

The inspected Pi has `wg0` at `10.192.80.1/24`, IPv4 forwarding enabled,
and a route for `192.168.0.0/24`. A remote WireGuard client must include
`192.168.0.0/24` (or `192.168.0.32/32`) in its peer `AllowedIPs` to route the
same LAN address. Client configurations cannot be verified from the server;
verify while connected from outside the LAN. During the routing check, the saved
phone endpoint was stale and the server's forwarding/NAT rules were missing.
The saved phone endpoint was updated privately (not in Git), UFW now permits
forwarding from `10.192.80.0/24` on `wg0` to `eth0`, and a subnet-scoped MASQUERADE
rule supports LAN/internet return traffic for the existing full-tunnel clients.
That NAT rule is persisted with PostUp/PostDown hooks in the existing `wg0.conf`,
whose prior version was backed up. SSH is allowed only from the VPN subnet on
`wg0` in addition to the previous LAN rule. No keys, peer identities, router
port forwards, or other service configurations were changed; WireGuard was not
restarted. Verify the actual client page loads as well as its recent handshake.

## Data, logs and backups

Docker named volumes persist PostgreSQL, Redis, currency rates and transaction
attachments across restarts and rebuilds. `restart: unless-stopped` starts
services after reboot when Docker starts. Never use `down -v` for updates.
Logs are size-limited; database SQL logging and nginx request logs are disabled
to avoid recording financial records, account query strings or OAuth codes.

```sh
sh deploy/status.sh
docker compose --env-file .env.pi.local -f docker-compose.pi.yml logs --tail 100 backend
docker compose --env-file .env.pi.local -f docker-compose.pi.yml run --rm --no-deps backup once
```

The backup service runs `pg_dump --format=custom` at startup and every 24 hours,
validates its table of contents, then atomically finalizes the file. It retains
30 days of completed dumps under ignored `private/backups/` with restricted
permissions. Failure preserves previous backups and is visible in logs and
the backup health check. Times in backup filenames are UTC. These dumps are
sensitive; copy them securely off the Pi for protection against drive failure.
They are not encrypted at rest. Protect the Pi and the backup destination.
Keep a separate secure copy of `.env.pi.local`; token decryption depends on
the existing encryption secrets. Attachment files live in the `attachments`
volume and require their own volume backup when attachments are used.

## Quick prebuilt deployments (Windows → Pi)

Commit and push changes to `dev`, then pull `dev` on Windows. The scripts require a clean tracked checkout matching `origin/dev`; untracked notes are fine. Builds run locally and upload only compiled artifacts through the existing SSH alias.

```powershell
.\deploy\build-frontend.ps1
.\deploy\build-backend.ps1
```

Run only the component you changed. Add `-NoUpload` to package locally or `-SshHost other-alias` to override `cardgames-pi`. Fast mode is the default: compile, typecheck, package and upload without unit tests. Add `-Test` for changed tests, `-TestBase <commit>` for a comparison base, `-TestPattern <pattern>` for specific tests, or `-FullTests` for all unit tests and backend lint-rule tests. `-TraceCommands` enables verbose PowerShell tracing; native commands and elapsed times are logged in every mode. End-to-end tests are deliberately not run against the live Pi; run them against an isolated test database when needed. Some upstream fixture-dependent unit tests can skip if fixtures are absent. Every script prints commands and live responses, saves a private log under `private/deploy-logs/`, and prints a green PASS or red FAIL. Do not proceed after a failure. Logs may contain sensitive diagnostics; do not share them without reviewing. Artifacts use the full commit hash. Uploads refuse to overwrite an existing published artifact; reuse it or remove it only when not deploying.

On the Pi:

```sh
cd ~/personal-finance-dashboard
git pull --ff-only origin dev
sh deploy/deploy-frontend.sh
git pull --ff-only origin dev
sh deploy/deploy-backend.sh
```

Run only the component you changed. These scripts serialize deploys, require the uploaded commit to match `origin/dev`, retain the running image as `:previous`, and restart only the selected component (backend deployments restart the shared-image investment worker too). Backend deployments also require a successful database backup and reload nginx. Existing runtime lockfile checks still apply. If dependencies changed, follow the matching-runtime guide below. Failed health checks stop the script; inspect logs before rollback. An image rollback cannot reverse database migrations.

## Updates and rollback

```sh
git pull --ff-only
sh deploy/deploy.sh
```

The script requires a fresh validated backup before migrations run on an
existing database. Image builds happen sequentially to reduce Pi memory
pressure. The stack declares container memory limits and uses namespaced
volumes. **The inspected Pi kernel currently reports that container memory
limits are unsupported**, so Docker discards those limits until cgroup memory
support is enabled by the operator. This deployment does not change kernel or
boot settings. Node's heap limit, Redis's 64 MB cache limit, and PostgreSQL's
64 MB shared buffers still apply, but are not whole-process memory caps.
Monitor available memory alongside the existing services. On a heavily loaded Pi,
build images on another ARM64 host or an ARM64 builder, load them, then use
`SKIP_BUILD=true sh deploy/deploy.sh`.

For frontend builds, the static Vue assets are architecture-independent. On
the development machine run the frontend's normal build, then prepare a small
artifact directory containing only `frontend-dist/` (the built `dist/` files),
the upstream `packages/frontend/nginx.conf`, and
`self-hosting/frontend/docker-entrypoint.sh`. Transfer that directory to an
ignored path such as `private/frontend-build/` on the Pi and run:

```sh
sh deploy/build-prebuilt-frontend.sh private/frontend-build
SKIP_BUILD=true sh deploy/deploy.sh
```

This uses the same upstream nginx runtime and skips the optional marketing
landing page, as configured by `SKIP_LANDING=true`. The artifact build context
contains no source records, environment files, or credentials.

For the backend, compile locally with its normal Vite build and prepare a
second small artifact directory containing `backend-dist/`, the source
`migrations/` directory, and the root `package-lock.json`. Transfer it to
`private/backend-build/`, then run:

```sh
sh deploy/build-prebuilt-backend.sh private/backend-build
SKIP_BUILD=true sh deploy/deploy.sh
```

The helper retains the first working ARM64 image as
`personal-finance-dashboard-backend:dependencies-base`. It compares the
artifact lockfile hash with `/app/package-lock.json` inside that image before
copying the new bundle and migrations. Native dependencies stay ARM64; no
TypeScript compiler or dependency installation runs on the Pi. If dependencies
change, supply a newly built matching runtime through `BACKEND_RUNTIME_BASE`.
The Dockerfile's published upstream fallback also requires an exactly matching
lockfile; an arbitrary `latest` image cannot safely supply different dependencies.
The deployment script refuses source builds with less than 3 GB available RAM.

For a rollback, first retain the failing deployment's logs and a fresh backup.
Restore the previous source commit and rebuild. A code rollback cannot undo
database migrations; restore a matching backup into a **separate database**
before switching the backend configuration. Do not overwrite the live database
while diagnosing an update.

## Recovery rehearsal without altering the live database

The example uses a new `finance_restore_check` database. Substitute a specific
backup filename observed in `private/backups/`.

```sh
docker compose --env-file .env.pi.local -f docker-compose.pi.yml exec -T db createdb -U finance finance_restore_check
docker compose --env-file .env.pi.local -f docker-compose.pi.yml exec -T db pg_restore -U finance -d finance_restore_check --no-owner --no-acl < private/backups/finance-YYYYMMDDTHHMMSSZ.dump
docker compose --env-file .env.pi.local -f docker-compose.pi.yml exec -T db psql -U finance -d finance_restore_check -c 'SELECT count(*) FROM information_schema.tables WHERE table_schema = '\''public'\'';'
```

Review the restored database and retain it until you choose to remove it.
Never print account records during a recovery check. A backup is useful only
when restoration has been verified.

## Authenticated MCP

The upstream MCP endpoint shares the app origin at `/mcp`; no separate daemon
or host port is required. It starts with the backend. OAuth discovery is served
at `/.well-known/oauth-protected-resource` and
`/.well-known/oauth-authorization-server`. Unauthenticated `/mcp` requests must
return 401. Existing read tools cover accounts, transactions, portfolio holdings,
balance history, cash flow and transfer-aware spending. The custom
`get_personal_net_worth` tool adds the personal category/contribution view.
The Pi deployment enables MCP writes with `MCP_READ_ONLY=false`. Every mutation
still requires its OAuth `finance:write` (or `finance:delete`) scope, an editing
entitlement, and native user/account permissions. Read-only grants cannot write.
Merchant rules additionally require the `toolset:automations` grant; reconnect
the client and select Automations if those tools are absent. Clients may cache
the tool list and need a tool refresh or reconnection after deployment changes.

### Investment MCP tools

After deployment, reconnect each ChatGPT account separately and select
Investments (`toolset:investments`) plus transaction editing (`finance:write`).
Grant `finance:delete` only if deletion is needed. Confirm the connected identity
with `get_user_profile`; the owner is derived from OAuth, not a tool argument.

The investment toolset already provides portfolio/holding reads, trade reads,
single trade create/update/delete, and `link_transaction_to_portfolio`.
`bulk_import_investment_transactions` accepts up to 50 reviewed execution rows
for one portfolio. Resolve securities and create missing holdings first. Pass
the original broker source row SHA-256 IDs, actual quantities, prices and dates.
Retry with the same IDs; the existing broker provenance lock prevents duplicate
cash and holding updates for those IDs. Distinct legitimate identical executions
need distinct stable source IDs. A row failure stops the batch, reporting the
completed rows and remaining source IDs. Do not import inferred trades from an
M1 trading-window summary or count a deposit as another buy. Link the existing
bank withdrawal once, and check existing broker funding records before linking
to avoid double counting.

For a non-mutating OAuth and tools/list smoke check on the deployed server:

```sh
MCP_VERIFY_INVESTMENTS=true node scripts/validate-mcp.mjs
```

This optional mode requests the investment, write and delete scopes but makes
only read calls. Its token stays in memory rather than replacing the existing
read-only session file. It verifies server-side discovery, not ChatGPT's cached
tool list; reconnect ChatGPT and confirm the tools are visible there separately.

Use `mcp.codex.example.toml` as a snippet in your private Codex configuration,
or `mcp.vscode.example.json` in VS Code's MCP configuration. Both examples
assume the SSH tunnel and matching localhost OAuth origin. Use the existing
WireGuard route to SSH to the Pi when away from home; keep the client's MCP URL
at `http://localhost:8095/mcp`. The API remains authenticated and is never public.
This avoids introducing certificates, a public OAuth service or port forwarding.

```sh
codex mcp add moneymatter --url http://localhost:8095/mcp
codex mcp login moneymatter --scopes finance:read,profile:read
codex mcp list
```

The Codex CLI and IDE extension share configuration. OAuth consent is a user
login action; the example never embeds bearer tokens. Approve only reading
scopes. See [official Codex MCP documentation](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)
for supported HTTP configuration and OAuth commands. A cloud-hosted assistant
cannot reach your private LAN solely because your laptop is on WireGuard;
use a local MCP client connected through the VPN or SSH tunnel.

The upstream OAuth server remains the authorization authority; this deployment
does not mint an unauthenticated API key or expose an anonymous finance tool.
