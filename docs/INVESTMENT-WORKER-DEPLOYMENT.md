# Dedicated investment analytics worker (Pi)

The Pi compose stack runs investment daily-history and analytics read-model jobs in one separate process using the same backend image. The HTTP backend no longer starts these two scheduled jobs when INVESTMENT_WORKER_EXTERNAL=true. Other deployments retain their existing scheduler. Manual routes and other jobs are not moved in this change.

The worker has a four-connection PostgreSQL pool, a single sequential work loop, a 640 MiB V8 heap ceiling, and a 0.75 CPU Compose quota. PostgreSQL persists all results as before. No new migration or financial math change is required. The worker skips startup bank-status cleanup and does not autorun the bank queue. Only the HTTP backend runs migrations. Docker memory limits require actual kernel support; NODE_OPTIONS limits V8 old-space, not total RSS.

## Deploy

Build the backend with the usual Windows script, then run deploy/deploy-backend.sh. The backend deploy script stops the previous worker, deploys the backend, then starts and waits for the new worker. The frontend does not need rebuilding for this change.

Check:
- docker compose --env-file .env.pi.local -f docker-compose.pi.yml ps
- docker compose --env-file .env.pi.local -f docker-compose.pi.yml logs -f investment-worker backend
- docker stats
- docker info (check memory limit support)

Compare HTTP runtime performance event-loop metrics, cached request latency, history latency, and time to render widgets during price updates. The heartbeat is a liveness indicator, not a guarantee that every analytics calculation succeeds. Keep the previous image and backup until validation succeeds. When rolling back to the old code, stop the worker and recreate backend with the old compose configuration so in-process cron jobs resume. Do not reverse migrations automatically.

## Still pending
Per-security incremental calculation, source-specific invalidation, narrow historical queries, and equivalent income/spending/net-worth/tax profiling. This split is not a promise of lower total CPU time or instantaneous cold analytics.
