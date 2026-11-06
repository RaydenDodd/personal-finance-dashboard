#!/usr/bin/env python3
"""Consistent SQLite auth-state backup with existing private file permissions."""
from pathlib import Path
import os
import shutil
import sqlite3
import tarfile
import tempfile
from datetime import datetime, timezone, timedelta

root = Path(__file__).resolve().parents[2]
private = root / 'private' / 'finance-gateway'
backups = private / 'backups'
os.umask(0o077)
backups.mkdir(mode=0o700, parents=True, exist_ok=True)
if not (private / 'state' / 'db.sqlite3').exists():
    raise SystemExit('Gateway storage is not initialized; existing backups retained.')
stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
with tempfile.TemporaryDirectory(prefix='backup-', dir=backups) as temporary:
    target = Path(temporary)
    source = sqlite3.connect(f'file:{private / "state/db.sqlite3"}?mode=ro', uri=True)
    destination = sqlite3.connect(target / 'db.sqlite3')
    with destination:
        source.backup(destination)
        if destination.execute('PRAGMA integrity_check').fetchone()[0] != 'ok':
            raise SystemExit('Gateway backup integrity failed; existing backups retained.')
    destination.close()
    source.close()
    for name in ['configuration.yml', 'users_database.yml']:
        shutil.copy2(private / name, target / name)
    shutil.copytree(private / 'secrets', target / 'secrets')
    archive = backups / f'gateway-{stamp}.tar.gz'
    with tarfile.open(archive, 'w:gz') as handle:
        for file in target.iterdir():
            handle.add(file, arcname=file.name)
    os.chmod(archive, 0o600)
cutoff = datetime.now(timezone.utc) - timedelta(days=30)
for archive in backups.glob('gateway-*.tar.gz'):
    if datetime.fromtimestamp(archive.stat().st_mtime, timezone.utc) < cutoff:
        archive.unlink()
print('Gateway encrypted-factor state and configuration backup completed; integrity verified.')

