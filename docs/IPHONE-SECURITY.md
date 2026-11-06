# My Finances on iPhone

The existing Vue application remains the application and the existing Pi remains its host. There is no separate iOS backend. The Home Screen start URL is:

**https://raydenfinance.duckdns.org/personal-finance**

## Security boundary

The host's existing Caddy instance terminates publicly trusted HTTPS and redirects HTTP to HTTPS. Its existing CardGames and WMATA sites remain intact. A separate, pinned Authelia container listens only on **127.0.0.1:9091**, using the same hostname under **/authelia**. The portal prefix is preserved. Internal forward-auth checks use `/api/authz/forward-auth` directly on loopback.

Authelia uses one authorized owner, an Argon2id password and a required second factor for every protected path. There is no public-host LAN exemption and no trusted-header automatic MoneyMatter login. MoneyMatter's own authentication remains required. Gateway cookies are Secure, HttpOnly and SameSite=Lax, with a 30-minute inactivity limit, 12-hour absolute lifetime and no remember-me extension. Failed attempts are regulated by user and IP. A password-only session does not authorize the finance upstream.

The ordinary finance origin stays private at the existing LAN/SSH address. Docker-aware filtering restricts the finance destination subnet to the existing LAN, WireGuard and finance bridge sources; nginx retains its source allowlist as an independent check. The private frontend is not an Internet alternative to the MFA gateway. PostgreSQL, Redis and the backend have no published ports. IPv6 has no finance listener and direct finance-port forwarding is explicitly denied in Docker's IPv6 ingress chain.

The public host always denies MCP paths/discovery/provider OAuth endpoints, backup/configuration paths and sensitive file types, even after gateway authentication. Private MCP remains on its existing origin over SSH/WireGuard. API requests with expired or missing gateway authentication return 401 with `X-Finance-Authentication: required`, never financial data or a portal HTML document disguised as an API response. The client performs a top-level redirect to its own portal and returns to the requested application page. Gateway failures remain closed.

The backend has an optional public HTTPS authentication profile inside the same process, using the existing database and secrets. Its Secure host-only session cookies have separate names and no signed-session browser cache. The private profile retains the existing LAN cookies, canonical MCP issuer and consent flow. The profile marker is server-derived from the exact public Host and trusted HTTPS proxy path; caller-supplied markers and forwarded headers do not select it.

Only the host Caddy source address is accepted for public HTTPS forwarding by nginx. Caddy handles WebSocket upgrades; nginx forwards API upgrades and leaves ordinary/SSE connections unbuffered. Public logout clears local financial state, signs out MoneyMatter when authorized and ends the gateway session. The portal logout response also expires public app session cookies when expired MFA prevents calling the app's sign-out endpoint.

## Safe activation

The checked-in staging configuration returns 503 for the financial application. Only the authentication portal and an MFA-protected, harmless verification probe are reachable. **Do not replace staging with the active upstream until the owner has enrolled a real factor and the security checks pass.** A test fixture's factor is not owner enrollment.

1. Back up the existing Caddyfile and private finance environment, and restore-verify a PostgreSQL backup.
2. Initialize and validate the gateway with `sh deploy/gateway/initialize.sh` and the pinned Compose file. Generated credentials and keys are confined to `private/finance-gateway` and are never printed or committed.
3. Retain the two existing Caddy sites and import `/etc/caddy/finance/finance.caddy`. Install `access-staged.caddy` as `/etc/caddy/finance/access.caddy`. Validate the full configuration before reloading Caddy.
4. Enroll the owner factor on their device, test missing/wrong second-factor rejection, and verify the gateway grants only a completed two-factor session. Check direct API, forged-header, path-variant and auth-service-failure behavior.
5. Verify private app sign-in, public Secure cookie behavior on a restored database, and a **fresh** private MCP OAuth/PKCE flow. A cached MCP token alone is insufficient.
6. After enrollment and test evidence, back up auth state, install the active access include, validate and reload Caddy. Repeat anonymous route/API/MCP checks and existing service health checks. If they fail, restore the staged include and reload.
7. Ask the owner to verify actual cellular access with Wi-Fi and WireGuard disabled. Emulation and a LAN test do not establish this.

## First owner enrollment and recovery

The separate gateway username/password is delivered through an owner-readable private local file, not chat or Git. Save it in a password manager. MoneyMatter's existing login is unchanged.

This installation uses an owner-only filesystem notifier instead of introducing an email service. The enrollment screen may call its first code an emailed verification code. Request that code in the portal; it is written to `private/finance-gateway/state/notifications.txt`. An operator can deliver the latest message through the existing private SSH connection. Never expose that file as a web route. Simply reaching a verification screen may precede the send request; verify the message exists before delivering it. Codes expire and only the latest requested code should be used.

After identity verification, add the portal's QR/setup key to the owner's authenticator and confirm a rotating code in the portal. Do not paste factor seeds, QR images or login codes into chat or diagnostics. Store the authenticator's recovery/export material using its secure backup mechanism. WebAuthn is available as a second factor with user verification required; enrolling an additional owner-controlled factor can reduce recovery risk.

Public password reset is disabled. Lost-factor or password recovery requires the existing private SSH/admin access and Authelia's documented administrative tools; it is not a public bypass. Back up both encrypted factor storage and its encryption key. Restoring only the SQLite file without its key is insufficient. Removing a factor requires deliberate operator recovery followed by real owner re-enrollment; do not temporarily weaken the public policy to one factor.

## Install on iPhone

1. Open Safari and navigate to **https://raydenfinance.duckdns.org/personal-finance**.
2. Complete gateway password + second factor, then MoneyMatter's existing login.
3. Tap **Share → Add to Home Screen**.
4. Enable **Open as Web App** if offered.
5. Name it **My Finances** and tap **Add**.
6. Launch the icon and confirm charts, navigation, login and logout in the installed app. Test reopening after backgrounding it and after a session expires.

Installed mode is detected through the display-mode query and iPhone's standalone flag. Its tab bar caps bottom safe-area padding at 34 CSS pixels, retaining home-indicator clearance without allowing a retained browser-toolbar inset to create a large empty strip beneath the buttons. Ordinary Safari retains its reported inset. Visual checks must measure the button row's distance from the bottom, not just the bar container's edge.

### Which login to use

The Home Screen app can require a fresh gateway session even when Safari is already signed in. At a URL containing `/authelia/`, use the gateway username **rayden** and the separate password delivered in `private/finance-gateway-owner-access.txt`, followed by the authenticator. The MoneyMatter email/password does not authenticate this gateway. At MoneyMatter's `/sign-in` page, use the existing MoneyMatter email/password instead. Save these as distinct password-manager entries and check which entry autofill selects.

Repeated wrong gateway credentials trigger a temporary lockout. Wait until its recorded expiration before retrying; changing passwords or removing MFA is not necessary. Never send passwords or authenticator codes in support messages.

The manifest uses standalone display, scope `/`, start URL `/personal-finance`, and authenticated same-origin fetching. Normal application navigation stays within Vue's router. Safe-area padding, Dynamic Island/home-indicator clearance, keyboard-aware dialogs, touch controls and a mobile bottom bar preserve the existing desktop sidebar and MoneyMatter styling. Personal accounts use compact mobile cards; desktop keeps its table. Charts distinguish horizontal inspection from vertical page scrolling.

## Sensitive data and connectivity

The gateway uses 16 KiB read/write buffers so analytics filters and normal browser cookies fit. Caddy forwards the original URI in the authorization header without also copying its query onto the internal authorization endpoint. Increasing this transport limit does not grant access: large unauthenticated requests must still return the normal MFA-required 401 response. The Cash flow composition card retains its explicit category filter, which preserves the endpoint's category detail and grouping behavior.

The self-hosted app does not persist financial query responses in IndexedDB or register a caching service worker. Startup removes the obsolete query cache and service-worker caches from this app origin. API/auth requests use no-store. Credentials stay server-side; session cookies are HttpOnly. Browser theme/preferences may persist, but balances, bank responses and Google credentials are not an offline database.

If the connection fails, financial views are hidden behind a clear retry screen rather than displaying old balances as current. The public app hides financial views while backgrounded and rechecks its session when returning. An expired gateway redirects to authentication; an expired MoneyMatter session goes to the normal app login. Offline/failed checks do not grant access.

## Maintenance

- **Caddy:** keep the existing host service. Validate with `sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile`, then reload it. Certificate issuance/renewal is managed by Caddy; no second certificate daemon is installed.
- **DuckDNS:** the existing updater and cron remain responsible for all existing domains, with `raydenfinance` added to the existing list. The token stays in its existing private script. Do not replace the other four domains.
- **Gateway:** `docker compose --env-file .env.pi.local -f deploy/gateway/compose.yml ps`. The official image is version/digest pinned. Review release/security notes, take a backup, validate a candidate and test before changing the pin. No automatic major upgrade is configured.
- **Auth backup:** `python3 deploy/gateway/backup.py` uses SQLite's consistent backup API and integrity check, then stores the encrypted state, configuration and required keys in owner-only archives with 30-day retention. `finance-gateway-backup.timer` schedules it daily. The existing PostgreSQL backup service is unchanged.
- **Ingress:** `finance-ingress.service` maintains only the finance-specific Docker ingress rules after Docker starts. It does not restart Docker or change other published services.
- **Public profile:** frontend and backend require `FINANCE_PUBLIC_ORIGIN=https://raydenfinance.duckdns.org`; frontend additionally requires `FINANCE_PUBLIC_PROXY_ADDRESSES=192.168.0.32`. Append the public origin to the existing app CORS allowlist. Keep the private `BETTER_AUTH_URL`, `AUTH_ORIGIN`, `AUTH_RP_ID` and `MCP_BASE_URL` unchanged.
- **Optional OAuth login:** if Google/Apple/another provider login is enabled later, register the public HTTPS callback displayed by that provider configuration as well as the retained private callback. Existing Google Sheets service-account synchronization needs no callback change or new authorization.

Actual cellular routing and installed-Safari behavior require owner-device verification. Do not infer successful router forwarding merely from UFW, or claim those physical-device checks passed from Playwright alone. If cellular access fails, inspect the existing router's TCP 80/443 forwarding to 192.168.0.32; do not change router configuration by assumption.

Official references: [Authelia Caddy integration](https://www.authelia.com/integration/proxies/caddy/), [proxy security notes](https://www.authelia.com/integration/proxies/introduction/), [Authelia sessions](https://www.authelia.com/configuration/session/introduction/), [Caddy forward authentication](https://caddyserver.com/docs/caddyfile/directives/forward_auth), [Authelia releases](https://github.com/authelia/authelia/releases).
