# Raspberry Pi deployment and recovery

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
BETTER_AUTH_URL=http://192.168.0.32:8095
AUTH_ORIGIN=http://192.168.0.32:8095
ALLOWED_ORIGINS=http://192.168.0.32:8095
MCP_BASE_URL=http://192.168.0.32:8095
AUTH_RP_ID=192.168.0.32
```

Recreate only this stack with the changed origin:

```sh
docker compose --env-file .env.pi.local -f docker-compose.pi.yml up -d --wait
```

The dashboard is then `http://192.168.0.32:8095`. Nginx permits only the existing
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
verify while connected from outside the LAN. No WireGuard keys or settings
need to be printed, committed or changed for this deployment.

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
MCP writes default to blocked by `MCP_READ_ONLY=true`, in addition to existing
scope checks. The ordinary app can still edit your records.

Use `mcp.codex.example.toml` as a snippet in your private Codex configuration,
or `mcp.vscode.example.json` in VS Code's MCP configuration. Both examples
assume the SSH tunnel and a matching localhost app origin. For direct VPN
access, change the URL to `http://192.168.0.32:8095/mcp` and ensure the app's
configured origin is that LAN origin too.

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
