# Investment analytics durable read model — first performance release

The new authenticated GET /investments/analytics/read-model reads a durable PostgreSQL result, or registers demand and returns pending. It does not invoke native financial replay. The existing scheduled-job registry refreshes one selection per run with Redis locking. Exact user, visible portfolio selection, benchmarks, dates and schema version identify a row. The existing canonical calculation engine is unchanged. Existing history widgets retain their specialized history API. Old analytics and overlap-detail routes remain compatible.

The first version uses five-minute refreshes, one selection per scheduled run, bounded retry and seven-day retention. It is a persisted demand-driven result cache, not a fully incremental per-security materialization. It does not yet split the calculation engine or implement event-driven source invalidation. Focused response projections are available; the shared frontend consumer initially requests the complete compact projection to preserve all existing chart behavior. Cold selections display loading until the scheduler publishes a result. No request falls back to expensive replay. Production jobs must be enabled for this path.

Validation before deployment (Windows, root):
```powershell
git pull --ff-only origin dev
npm run typecheck -w packages/backend
npm run test:unit -w packages/backend -- --testMatch "**/*.unit.ts" --testPathPattern="read-model" --passWithNoTests=false --runInBand
npm run test:unit -w packages/frontend -- --run
npm run build -w packages/backend
npm run build -w packages/frontend
```

Run migration and authenticated cold/warm/ownership tests on an isolated restored database before production. Compare the new response against the old endpoint for the same selection and source revision. Verify pending, retries, hidden portfolios, date filters, every widget, memory and latency. The worker is production-only, so manually enable it in the isolated environment using production mode without real provider credentials. Do not deploy until validation succeeds. Use normal deployment scripts with backend first, then frontend. Back up production first; the new table is derived and contains sensitive financial analytics. No source ledger is changed by the migration.
