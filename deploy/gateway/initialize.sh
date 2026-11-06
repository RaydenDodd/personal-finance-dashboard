#!/bin/sh
# Run on the Pi. Creates one owner identity; secrets never enter Git or stdout.
set -eu
cd "$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
umask 077
target=private/finance-gateway
mkdir -p "$target"
test -e "$target/healthcheck.env" || : > "$target/healthcheck.env"
chmod 600 "$target/healthcheck.env"
if [ -e "$target/users_database.yml" ]; then
  echo 'Existing gateway identity and secrets preserved.'
  exit 0
fi
mkdir -p "$target/secrets" "$target/state" "$target/backups"
chmod 700 "$target" "$target/secrets" "$target/state" "$target/backups"
for name in session storage identity; do
  test -e "$target/secrets/$name" || openssl rand -hex 32 > "$target/secrets/$name"
done
docker run --rm --network none authelia/authelia:4.39.28@sha256:bd97cff4fcbf715b5ff1f9ae286afbe6033afce385302520b0368122d43a6f54 authelia crypto hash generate argon2 --random --random.length 40 --memory 65536 --iterations 3 --parallelism 2 > "$target/password-output.tmp"
python3 - <<'PY'
from pathlib import Path
import re, json, os
root=Path('private/finance-gateway')
text=(root/'password-output.tmp').read_text()
digest=re.search(r'\$argon2id\$[^\s]+',text)
password=re.search(r'(?im)^\s*(?:Random )?Password:\s*(\S+)\s*$',text)
if not digest or not password:
    raise SystemExit('Password generator output was not recognized; no identity was written.')
owner_password=password.group(1).strip('"\'')
(root/'owner-access.txt').write_text('My Finances gateway\n\nURL: https://raydenfinance.duckdns.org/authelia/\nUsername: rayden\nPassword: '+owner_password+'\n\nSave this password in your password manager. This is separate from MoneyMatter login.\nMFA must be enrolled on your own device before public finance access is enabled.\nRecovery requires your private SSH/admin access; no email reset is enabled.\n')
(root/'users_database.yml').write_text('users:\n  rayden:\n    displayname: My Finances owner\n    password: '+json.dumps(digest.group(0))+'\n    email: owner@localhost\n    groups: [finance_owner]\n')
for file in [root/'owner-access.txt',root/'users_database.yml',*list((root/'secrets').iterdir())]: os.chmod(file,0o600)
(root/'password-output.tmp').unlink()
PY
install -m 600 deploy/gateway/configuration.yml "$target/configuration.yml"
echo 'Gateway initialized privately. Owner credentials are in private/finance-gateway/owner-access.txt.'

