# How to view the MoneyMatter database

The production database is PostgreSQL in Docker on the Raspberry Pi, not on Windows. The container is `personal-finance-dashboard-db-1`; configured database and owner role are `finance`. Redis handles cache/queues separately. PostgreSQL version, size and Docker IP may change; inspect live rather than assuming old observations are current.

## Option 1: terminal (nothing to install)

From Windows PowerShell:

```powershell
ssh cardgames-pi
```

On the Pi:

```sh
docker exec -it personal-finance-dashboard-db-1 psql -U finance -d finance
```

In psql:

```sql
\dt
\d "Transactions"
SELECT version();
SELECT pg_size_pretty(pg_database_size(current_database()));

BEGIN READ ONLY;
SELECT id, date FROM "Transactions" ORDER BY date DESC LIMIT 20;
ROLLBACK;
\q
```

Use `\dt` to list tables and `\d "TableName"` to inspect columns, constraints and indexes. Table names are case-sensitive when quoted. Do not run UPDATE, DELETE, INSERT, schema changes or unbounded queries against production for exploration.

## Option 2: DBeaver Community on Windows

Install from https://dbeaver.io/download/ or PowerShell:

```powershell
winget install --id dbeaver.dbeaver -e
```

You do not need a separate Windows PostgreSQL server.

On the Pi, find the current Docker address:

```sh
docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' personal-finance-dashboard-db-1
```

In a separate Windows PowerShell terminal, leave the SSH tunnel running (replace the example Docker IP with the value returned):

```powershell
ssh -N -o ExitOnForwardFailure=yes -L 127.0.0.1:15432:172.29.31.3:5432 cardgames-pi
```

No output is normal. The listener binds only to your Windows loopback; the Pi connects internally to PostgreSQL. Do not publish port 5432 or change firewall/router rules. If the database container is recreated, recheck its IP.

In DBeaver choose Database → New Database Connection → PostgreSQL:

| Setting | Value |
| --- | --- |
| Host | 127.0.0.1 |
| Port | 15432 |
| Database | finance |
| Username | finance (owner; prefer a separately provisioned read-only role) |
| Password | Current database password from the private Pi configuration |

Retrieve the password privately on the Pi if using the owner account:

```sh
cd ~/personal-finance-dashboard
grep '^APPLICATION_DB_PASSWORD=' .env.pi.local
```

This displays a secret; do not paste the output into chat, screenshots, logs or Git. If the stored value has quoting, use the actual configured password, not literal dotenv quote characters. Keep it in a password manager. Enable DBeaver's read-only connection restriction; it is client-side protection, not database-enforced access control. For regular use, have the owner provision a limited PostgreSQL role with CONNECT, schema USAGE and SELECT only on necessary tables; do not grant write privileges or access to credentials/auth tokens. Provisioning that role is a separate authorized database change.

Click Test Connection, allow the driver download, then Finish. Browse Database Navigator → finance → Schemas → public → Tables. Open a table and its Data tab to view rows, or use SQL Editor for bounded read-only queries. Stop the SSH tunnel with Ctrl+C when finished.

## Understand the records

- Native Accounts and Transactions hold the ordinary ledger; portfolios, holdings, investment transactions and transfers have separate models.
- Personal-finance historical snapshots and principal provenance are distinct from native transactions. Payroll statements and salary events are distinct from bank deposits.
- Check Sequelize model definitions in `packages/backend/src/models/` and migrations before assuming field names or units. Ordinary money fields may be integer cents; investment amounts may be decimal strings. API/UI decimal values are not necessarily raw database values.
- Production includes confidential financial records and encrypted credentials. Never export entire tables for casual debugging. Use bounded SELECT queries or synthetic data; do not expose sensitive rows in logs.

For backups, recovery and deployment see [How to deploy](HOW-TO-DEPLOY.md). Prefer a restored isolated database for experiments, schema changes and mutation testing.
