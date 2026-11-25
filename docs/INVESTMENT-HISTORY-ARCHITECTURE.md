# Incremental investment account history

## Existing services reused

The native `computeHoldingsValueByDate` owns quantity replay and valuation. Its existing transaction folding, `buildPriceLookup`, `createFindPriceForDate`, `createShareUnitFactor`, `computePortfolioCashByDate`, and `nativeExternalFlow` remain the calculation sources. Current holdings, FIFO basis, realized gains, brokerage imports and account calculations are preserved. Period dollar and percentage totals reuse `positionPeriodReturns` and `dailyPositionChange` rather than a second return formula.

## New read and persistence layer

The native replay has an optional chronological evidence stream: recorded transactions, dated complete/partial position observations, and quantity openings inferred backward through documented disposals. Partial observations merge individual securities. A missing quantity or price is never replaced by zero or purchase cost. Historical splits use the existing published share-unit normalization. In-kind movements use their recorded direction; unsupported direction remains unknown. Dated cash is included where evidenced.

Retained Robinhood brokerage source records supply purchases, sales, receipts and evidenced cancellations that were blocked from native trade import during corporate-action review. A read-only adapter deduplicates them against native transaction source-row markers before passing them into the same replay. This creates no financial transactions, cash movements, cost basis or lots. Same-ticker exchanges and published splits are not applied twice; unresolved delisted identities remain specific coverage gaps. Historical crypto gaps reuse the native Coinbase and Yahoo adapters on the existing security IDs.

`buildHistory` no longer uses account `historyComplete` to restrict security valuation. It separates supported holdings subtotals from complete account observations. Missing trading-day prices are distinct from weekends/holidays, which reuse the last actual session close.

Three derived tables persist daily account values, progress and dirty ranges. Database source-change triggers enqueue only affected accounts; date changes use the earliest affected date, while changed position observations can require earlier quantity reconstruction. Quote updates that change no valuation inputs do not enqueue work. The existing scheduled-sync framework runs one account/year chunk at a time under its normal shared lock, with a short run budget and committed checkpoints. No financial source rows are rewritten.

The focused `/investments/analytics/history` endpoint reads these totals and aggregates selected accounts in the backend. Its columnar response includes dates, account totals, combined totals and compact coverage. Optional events and funding are requested explicitly. It does not load holdings tables, ETF constituents, overlap computations or source documents. Missing-record details are a separate lazy request. Individual security graphs continue using the native price endpoint when opened.

Chart-range changes filter the cached dates; other widgets share both the frontend query cache and persisted account totals. Hidden portfolios are filtered on every request and are not selected by the background worker. Net-worth exclusion remains independent of visibility.

The chart defaults to one combined dollar-value line. Account lines are an explicit option. Supported partial values are account/holdings values, not deposit-adjusted investment returns. The coverage dialog lists first imported purchases, missing price ranges and quantity discrepancies against real observations.

## Current focused-history read optimizations

The focused history endpoint is used by Portfolio Performance, Value vs. Invested Capital and Portfolio Comparison; Benchmark Comparison combines it with its broad benchmark projection. The worker updates persisted daily account values independently of the broad read model. Short ranges can also use intraday account history. Optional capital, period opening (`gainFrom`) and events control return/event work; a chart-mode change on Portfolio Performance does not change the request, because its gain and return summary always needs capital and the selected opening date.

As of `bedc350`, complete non-audit HTTP history responses are cached in-process for 60 seconds, with a four-response / 4 MiB aggregate serialized-data cap. Cache keys include owner, currency, dates, account metadata and source revision, plus requested flags. Pending and audit responses are not retained. Concurrent requests with the same authorized scope and dates share raw daily rows and aggregate reads while in flight; each request still applies its own return and display options. This is separate from the Redis projection cache. The client shares identical history requests, polls pending every ten seconds and ready history every five minutes during market hours, without background or focus refetch. See [worker deployment](INVESTMENT-WORKER-DEPLOYMENT.md) and [current read model](INVESTMENT-READ-MODEL.md).

## Verification requirements

Before marking deployed: reconcile representative early purchases and sold positions against source records, measure warm focused-response size/latency, verify no source replay on range changes or repeated requests, exercise source-price invalidation, check hidden portfolios and financial preservation fingerprints, and test combined/account options and mobile interactions. A queued or partially materialized history is not completion evidence.
