# SimpleFIN polling and transaction recovery

Manual connection sync, scheduled sync, and account sync all use the native provider importer. Connections are batched across accounts; normal polling resumes from the last successfully persisted fetch checkpoint with a five-day overlap. Empty accounts advance their checkpoint too. Existing installations use the connection checkpoint until each account has its own; newly created accounts receive an initial 90-day backfill, split into 44-day windows. Explicit historical loads remain available and use the same window and request limits.

Posting time determines eligibility for a provider window; purchase time remains the displayed transaction date. Stable provider IDs, preserved original-source IDs, and historical reconciliation prevent duplicate rows and preserve corrected categories. Pending transactions remain excluded until posted.

Every actual accounts HTTP attempt, including one permitted transient retry and balance-only reads, reserves an atomic Redis request slot. The rolling 24-hour limit is 24 per Access URL and endpoint scope (all accounts versus each individual account). Credentials are hashed for Redis keying and never logged. Exhaustion or unavailable budget storage fails visibly rather than sending an unmetered request. The counter survives backend restarts through the existing Redis volume. There was no complete request ledger before this release, so earlier request totals cannot be established from retained logs alone.

Sync status distinguishes API receipt, provider balance timestamp, latest returned posted transaction, pending/posted response counts, and newly inserted record counts. A response timestamp is not evidence that an institution refreshed its transaction feed. Scoped account/institution warnings are retained and displayed; affected accounts fail while unaffected accounts can import. A connection-wide successful-import timestamp only advances when every selected account completed.

The backend cron runs at each user's configured UTC hours. The Pi's six-hour systemd fallback skips recent successful or active syncs; the Tuesday preparation job can also initiate sync. All paths share the provider budget. Queue deduplication and account locks prevent concurrent jobs from duplicating writes.

Official guidance: https://beta-bridge.simplefin.org/info/developers (24 requests/day, maximum 90-day window, approximately five-day overlap). Protocol: https://www.simplefin.org/protocol.html.

Targeted checks: SimpleFIN client retry/window/budget tests, incremental cursor tests, and persistence tests for late posting, repeat imports and preserving historical categorization. Live recovery on November 24, 2026 used one saved provider response twice: two Amex records inserted, repeat inserted zero; U.S. Bank pending rows were not imported.
