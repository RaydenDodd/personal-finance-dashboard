# How to work on the MoneyMatter fork

This is the repository version of the owner's developer walkthrough, adapted from the instructions shared in chat. See [deployment](docs/HOW-TO-DEPLOY.md) and [database viewing](docs/HOW-TO-VIEW-DATABASE.md) for the complete operational procedures.

## Repository and environment

- Fork: https://github.com/RaydenDodd/personal-finance-dashboard; working/deployment branch: dev.
- Windows development checkout: $HOME\Documents\GitHub\Projects\personal-finance-dashboard (adjust to your actual checkout).
- Raspberry Pi: SSH alias cardgames-pi; checkout ~/personal-finance-dashboard.
- Vue 3 / TypeScript / Vite frontend, Node.js / Express / Sequelize backend, PostgreSQL and Redis/BullMQ.
- Application code in packages/frontend/src and packages/backend/src; shared financial logic/types in packages/shared/src; infrastructure in deploy and self-hosting.

## Develop on Windows

Open PowerShell in your checkout:

```powershell
cd "$HOME\Documents\GitHub\Projects\personal-finance-dashboard"
git status
git switch dev
git pull --ff-only origin dev
```

Preserve unrelated local changes. The owner normally works on dev; create a feature branch only when requested or when branch protections require it. If using one, merge the reviewed changes back into dev before deployment. Install the Node version specified by the repository and run npm ci at the root when dependencies need installation. Do not modify the lockfile merely to work around local installation problems.

For frontend development:

```powershell
.\deploy\start-local-dev.ps1
```

Open http://localhost:8110. The preview uses the live Pi backend via SSH. **Saving or editing financial records in this preview changes production data.** Use fixtures or an isolated development database for mutation testing. The preview is not a separate backend development environment.

Make changes in the relevant package; use existing shared components and services. Read AGENTS.md and CLAUDE.md before editing. Stage only intentionally changed files, inspect the diff, and commit/push only as authorized by the owner.

## Verification

```powershell
npm run typecheck -w packages/backend
npm run test:unit -w packages/backend -- --testMatch "**/*.unit.ts" --passWithNoTests=false --runInBand
npm run test:unit -w packages/frontend -- --run
npm run build -w packages/frontend
npm run build -w packages/backend
```

For a focused backend test add --testPathPattern="name-of-test". This Windows glob override was needed when the default Jest matcher found no tests. A zero-test exit is not a successful test. Run integration/e2e tests using the repository's isolated test environment, never production. See the engineering rules in CLAUDE.md.

## Deploy

Use the four prebuilt scripts in deploy/; see the [deployment guide](docs/HOW-TO-DEPLOY.md). Windows produces and uploads compiled artifacts; the Pi checks the matching source commit, builds the runtime image and restarts only the affected service. Backend deployment takes a validated database backup. Do not rebuild the whole stack on the Pi unnecessarily.

## Inspect the database

The production database runs in the personal-finance-dashboard-db-1 PostgreSQL container on the Pi. Database and configured owner role: finance. Redis is separate. Use psql or DBeaver through an SSH tunnel; see [database guide](docs/HOW-TO-VIEW-DATABASE.md). Do not publish PostgreSQL ports or disclose passwords.

## Sensitive information

Keep .env.pi.local, API tokens, payroll and brokerage exports, original spreadsheets, database backups and logs out of Git. Use synthetic fixtures when sharing a reproduction. Verify all relevant data before a reconciliation or correction, and get explicit authorization for production writes.
