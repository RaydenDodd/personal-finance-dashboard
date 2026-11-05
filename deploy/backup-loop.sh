#!/bin/sh
set -eu
umask 077
mkdir -p /backups
chmod 700 /backups

backup_once() {
  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  temporary="/backups/.finance-${stamp}.tmp"
  destination="/backups/finance-${stamp}.dump"
  if pg_dump --format=custom --no-owner --no-acl --file="$temporary"; then
    pg_restore --list "$temporary" >/dev/null
    mv "$temporary" "$destination"
    find /backups -maxdepth 1 -type f -name 'finance-*.dump' -mtime "+${BACKUP_RETENTION_DAYS:-30}" -delete
    echo "Database backup completed at $stamp"
  else
    rm -f "$temporary"
    echo 'Database backup failed; existing backups retained' >&2
    return 1
  fi
}

if [ "${1:-}" = once ]; then
  backup_once
  exit
fi

while :; do
  backup_once || true
  sleep 86400
done
