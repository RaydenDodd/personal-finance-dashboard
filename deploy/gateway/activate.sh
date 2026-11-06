#!/bin/sh
# Explicit operator activation after real enrollment and recorded verification.
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
umask 077
python3 - <<'PY'
from pathlib import Path
import json,sqlite3
proof=Path('private/pwa-security/release-checks.json')
if not proof.exists() or proof.stat().st_mode & 0o077:
 raise SystemExit('Private release verification is missing or has unsafe permissions; public finance remains staged.')
evidence=json.loads(proof.read_text())
for key in ['ownerEnrollmentVerified','mfaTestsPassed','edgeTestsPassed','failClosedPassed','privateMcpFreshAuthPassed','publicAndPrivateAuthPassed','mobileBrowserTestsPassed']:
 if evidence.get(key) is not True: raise SystemExit('Required security verification is incomplete; public finance remains staged.')
db=sqlite3.connect('file:private/finance-gateway/state/db.sqlite3?mode=ro',uri=True)
if db.execute('SELECT COUNT(*) FROM totp_configurations WHERE username=?',('rayden',)).fetchone()[0] != 1:
 raise SystemExit('Real owner authenticator enrollment is missing; public finance remains staged.')
PY
python3 deploy/gateway/backup.py
saved=private/pwa-security/access-before-activation.caddy
sudo cat /etc/caddy/finance/access.caddy > "$saved"
rollback() {
 sudo install -m 644 "$saved" /etc/caddy/finance/access.caddy
 sudo systemctl reload caddy
}
trap rollback EXIT HUP INT TERM
sudo install -m 644 deploy/gateway/access-active.caddy /etc/caddy/finance/access.caddy
sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null
sudo systemctl reload caddy
status() { curl -sS --resolve raydenfinance.duckdns.org:443:127.0.0.1 -o /dev/null -w '%{http_code}' "https://raydenfinance.duckdns.org$1"; }
[ "$(status /api/v1/accounts)" = 401 ] || { echo 'Anonymous API protection failed; reverting to staging' >&2;exit 1; }
[ "$(status /mcp)" = 404 ] || { echo 'Public MCP restriction failed; reverting to staging' >&2;exit 1; }
case "$(status /personal-finance)" in 302|303) ;; *) echo 'Public application authentication failed; reverting to staging' >&2;exit 1;; esac
trap - EXIT HUP INT TERM
echo 'Public finance upstream activated behind mandatory MFA; anonymous API/app/MCP checks passed.'

