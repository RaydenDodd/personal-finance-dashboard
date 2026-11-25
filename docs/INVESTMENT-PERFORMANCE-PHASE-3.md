# Analytics performance phase 3

Source statement revisions invalidate persisted analytics conservatively across users. Each active selection is rebuilt on a changed revision after a 90-second minimum interval, or hourly for reconciliation. Revision is captured before calculation, so writes during replay remain dirty. This is a coarse source-table invalidation mechanism, not per-security incremental computation. Redis caches only small (<=512 KiB) owner/selection/section/build-version projections for 90 seconds; PostgreSQL remains authoritative and unchanged checks precede Redis. Currency is part of the selection key. Existing v1 derived rows are removed by the scheduler, so expect a cold rebuild after upgrade. No source records are deleted.

Price SSE events no longer immediately refetch every history/analytics query. Visible queries poll on their existing schedule; pending reads poll at 10 seconds. The job runs at most one selection per 30 seconds. This reduces contention but does not isolate the replay in another process.

Validate migration, revision changes, conditional responses, currency/visibility, and all chart outputs on an isolated database. Check Redis cache size and response timings. Per-security computation, worker isolation, history range reduction and other finance domains remain subsequent work.
