# Investment analytics durable read model

Current architecture as of backend `bedc350` and frontend `ec1e029` (2026-11-25). This supersedes the initial read-model release and phase 3 descriptions. See [worker deployment](INVESTMENT-WORKER-DEPLOYMENT.md), [account history](INVESTMENT-HISTORY-ARCHITECTURE.md), and [widget integration and verification](INVESTMENT-WIDGETS.md).

## Request and publication flow

1. A widget/page selects an authorized portfolio scope, benchmark set, optional position-return dates and response section. The authenticated GET `/investments/analytics/read-model` resolves ownership, hidden portfolios and default currency on the server. A canonical sorted/deduplicated selection and schema version (currently 2) produce the selection hash; the owner is part of the database identity. Sections are projections of the same selection, not separate calculations.
2. PostgreSQL `InvestmentAnalyticsReadModels` records demand and the last published result. Admission is serialized per owner and limited to 48 selections. Recent demand writes are avoided for 30 seconds. No financial replay is performed by this GET, including on a cold miss. It returns pending without analytics, ready, stale, or retrying; the latter two may retain the previous valid result.
3. The separate Pi investment worker runs daily-history and read-model jobs using the backend image, sequentially, under PostgreSQL transaction-scoped advisory locks. Other deployments can use the in-process scheduler. The read-model job takes one eligible selection per run, prioritizing unbuilt/base selections over dated selections. It considers demand from the last ten minutes, refreshes changed revisions after at least 90 seconds, and reconciles hourly. Revisions include source-table counters and the Eastern calendar date. Failures retain the previous result and use bounded backoff (up to 900 seconds). Cleanup runs at most every ten minutes and removes seven-day-unused selections, obsolete rows without currency, and unreferenced range bases.
4. The worker reuses the canonical investment engine in `services/investments/analytics/service.ts`; it rechecks selection ownership/visibility before publishing. PostgreSQL is authoritative; Redis is not a job queue or financial source.
5. A repeat client request supplies `knownBuiltAt`; if unchanged, the server returns status without retransmitting analytics. Otherwise it checks an owner/selection/section/build-time Redis key (90-second TTL, at most 512 KiB per projection, never caches the all section). On a miss, the backend projects JSONB in SQL before transferring it, restores the established response shape, and coalesces identical in-flight projections using the cache key and source revision. Redis failures fall back to PostgreSQL.

## Date ranges and price work

- Direct current-day, unrealized/all and standard-period position views use the undated base selection where applicable. A historical/custom position-return range has its own exact selection; underlying heatmap uses exposure instead.
- If the worker finds a successful same-owner, same-scope and same-source-revision undated base, `buildHistory(positionDates)` replays only necessary valuation dates for position quantity/value callbacks, not the full account-history series. A single-day custom range uses the previous US equity session as the opening date. Existing trade, split, coverage and period-return logic is retained. Unchanged analytics and standard returns come from the base; custom holdings return fields and performance totals are merged. If the source revision changes mid-calculation, do not publish the mixed-revision overlay. No compatible base means a full calculation.
- `InvestmentAnalyticsRangeBases` pins one immutable full base per owner/base key/build timestamp. A compatible custom result stores only its complete holdings array and performance totals in the range overlay. Reads merge the version-pinned base and overlay after projecting each; a newer base cannot silently replace an older range's inputs. Old full rows remain readable. Migration `20261125213000-investment-analytics-range-overlays.ts` is required; read the downgrade warning in the worker guide.
- The initial two-minute whole-window cache from `a5279f5` was superseded for revision-aware worker calculations by per-security price reuse in `bedc350`. Price insert/update/delete revisions (including old/new IDs) and a truncate epoch allow unchanged security windows to be reused; missing, changed or expired windows alone are reloaded. Ten-minute horizon, active security set only, at most 200,000 retained rows; exceeding the bound clears retention rather than dropping calculation inputs. Future rows and expired intraday observations are excluded. Identical price-row sequences can reuse prepared lookup/split indexes; date formatting is memoized. Migration `20261125220000-investment-security-price-revisions.ts` is additive. The global source revision still controls result freshness; this is incremental price retrieval, not full incremental financial computation.

## Widget routing and client caching

The common frontend hook `useInvestmentAnalytics` shares Vue Query keys across identical scope, dates, section and hidden-portfolio settings. Unchanged responses retain the prior analytics object. No-data pending reads poll every five seconds, stale/retrying data every 30 seconds, and ready reads every 60 seconds during US equity market hours or 120 seconds outside them; polling in the background and focus refetch are disabled. The focused history hook is independent and shares persisted daily totals for performance, value vs. invested capital, and portfolio comparison; benchmark also uses it for account history. See the widget and history guides for the full section mapping and cache limits.

## Diagnostics and remaining work

Historical deployment evidence supplied from Pi logs: commit `467bb42` took about 19.85 s for a custom range including publication (7.41 s replay, ~3.31 s price retrieval, 2,542 historical days, ~144,381 price rows, 13.62 MB full payload). On `239cccf`, the same-revision sparse path was observed at 12.83 s including publication, three valuation dates and cached unchanged requests of 12–29 ms. These are measurements from earlier deployments, not benchmarks of current HEAD. Initial dashboard reads previously took 4–6 s even with an idle worker.

Use worker logs for `Investment analytics phase performance` and `Investment analytics read-model publication`: inspect `reusedBase`, `valuationDays`, `priceCacheHit`, `storageMode` (range-overlay/full), `payloadBytes`, serialization/persistence durations and error/retry events. Compare a cold base, a new custom range, a second range, and a price change. Measure HTTP response size/latency independently of worker time, and ensure all widget types remain scrollable while loading.

Full per-security financial materialization, finer-grained result invalidation, separately materialized exposure, further focused-history/range reductions, and end-to-end financial accuracy and Pi load testing remain work to validate or implement. The newer overlay and price-revision migrations and header UI are present in the repository; the historical measurements above do not establish that those later commits were deployed or passed live testing.

## Validation before deployment

```powershell
git pull --ff-only origin dev
npm run typecheck -w packages/backend
npm run test:unit -w packages/backend -- --testMatch "**/*.unit.ts" --testPathPattern="read-model" --passWithNoTests=false --runInBand
npm run test:unit -w packages/frontend -- --run
npm run build -w packages/backend
npm run build -w packages/frontend
```

Run migration and authenticated cold/warm/ownership tests on an isolated restored database before production. Compare the new response against the old endpoint for the same selection and source revision. Verify pending, retries, hidden portfolios, date filters, every widget, memory and latency. The worker is production-only, so manually enable it in the isolated environment using production mode without real provider credentials. Do not deploy until validation succeeds. Use normal deployment scripts with backend first, then frontend. Back up production first; the new table is derived and contains sensitive financial analytics. No source ledger is changed by the migration.
