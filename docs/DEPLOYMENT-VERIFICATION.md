# Deployment verification

Verified on the existing ARM64 Raspberry Pi 5 using its existing Docker, SSH and WireGuard setup. No public proxy, DNS service, port forwarding, paid bank connector or new VPN was added.

- Dashboard: `http://192.168.0.32:8095/personal-finance`, with MoneyMatter's original dashboard still at `/dashboard`.
- Six finance containers are healthy, use persistent volumes and restart unless stopped. Other existing containers were retained.
- The refreshed read-only Sheet import preserved 648 observations across 16 reporting accounts and 44 recorded dates (2022-06-15 through 2026-11-01), including October and November 2026. USD balances are rounded to cents. Work, totals, blank cells and principal inference were excluded. The refresh inserted 30 observations and recognized the original 618 as duplicates.
- A private API readback verified every imported date, USD balance, formula, mapping and category total. No native spending transactions were created by importing snapshots.
- Automatic PostgreSQL backups are running. A refreshed post-import backup was restored into a separate database and verified to contain all 648 snapshots. The original backup/restore also verified all 16 reporting accounts. The live database was not replaced.
- Native OAuth PKCE, missing/invalid token rejection, MCP initialization, listing 114 tools, native account reads and the custom net-worth read passed. Codex completed OAuth login with reading scopes; server-side MCP writes remain disabled.
- Synthetic browser checks covered all nine chart views, early partial observations, the moving vertical pointer guide, dated chart clicks, category/account drilldowns, accurate date spacing, manual balance entry, transfers, CSV mapping/preview/commit, light/dark themes and mobile overflow. Full-shell synthetic screenshots were visually compared with the upstream README screenshots. Original dashboard, layout, CSS and shared UI library files have no changes against the fork's upstream base.
- Backend TypeScript checks and the broad unit suite passed: 2,688 passing tests, 104 skipped, zero failures. Frontend TypeScript checks, its focused importer tests, the Sheet normalizer tests and both production builds passed. Bank API credentials were not used in tests.

The owner's initial sign-in credentials are in the ignored local `private/owner-credentials.json`; they are not in Git, screenshots or application logs. Keep that file private. Pi secrets remain in mode-600 `.env.pi.local`. Full extension recovery uses PostgreSQL backups, since upstream's in-app export does not include the custom reporting tables.

For local Codex MCP access, retain the SSH tunnel:

```powershell
ssh -N -L 8095:192.168.0.32:8095 cardgames-pi
```

Its MCP URL is `http://localhost:8095/mcp`; remote traffic is encrypted by SSH and can travel over the existing WireGuard route. The dashboard also uses the LAN address through WireGuard. On 2026-11-05, the user verified that both MoneyMatter and OctoPi load on the phone with Wi-Fi off and WireGuard connected.

The saved phone endpoint was stale and was updated privately. After the handshake succeeded, packet counters identified missing forwarding/NAT rules. UFW now forwards the existing VPN subnet from `wg0` to `eth0`, with a subnet-scoped NAT rule persisted in the existing WireGuard PostUp/PostDown hooks. SSH from the authenticated VPN subnet is allowed for MCP tunneling. Keys, peer identities and router port forwards were unchanged; no services were restarted for this routing fix. The original WireGuard configuration was backed up before editing.

Historical combined/renamed rows remain faithful aggregates. They cannot be reliably split into current component accounts without dated evidence. Investment principal and gains remain unavailable until an explicit opening basis and reliable contributions are entered. Manual mode is functional; SimpleFIN is retained but not activated, and Plaid is deferred. Monthly checks explicitly mark unavailable day-one valuations missing rather than substituting newer balances.

Minecraft's existing startup file `/home/rayden/minecraft/mcstart.sh` was backed up and changed only from its original heap flags to `-Xms2G -Xmx4G`. Only `mcserver.service` was restarted for this change. Java's running arguments, the successful `Done` log entry and listening port 25565 were verified. Worlds, plugins and other configuration files were not edited.

The Pi kernel does not currently enforce Docker memory limits. Application heap/cache settings still apply. Build bundles on the development PC and use the prebuilt image helpers for updates; the source-build script refuses to compile when available memory is below its preflight threshold. See [deployment and recovery](../deploy/README.md).
