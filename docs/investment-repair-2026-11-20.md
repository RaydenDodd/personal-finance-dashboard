# Investments repair: reuse and evidence

The current consolidated adapter discards supported account values when any selected account has unknown cash, basis or incomplete opening history. It also requires simultaneous broker snapshots for historical returns and does not request current equity quotes. These are verified missing capabilities in the analytics integration, not reasons to replace portfolio accounting.

Reuse `getHoldingValues`, `getPortfolioSummary`, `computeHoldingTotals`, the native FIFO gains calculator, broker observations, `SecurityPricing`, composite providers, native historical price sync, cron wrappers, Vue Query, dashboard grid/layout persistence, scrollbar and chart interaction components. Preserve hidden-portfolio exclusion independently of net-worth inclusion.

Add only the following missing integration behavior:

- Immutable dated positions/basis observations in the existing broker snapshots. A basis-only export has null market values, cash and account total; it never creates a quote. The native holdings replay anchors quantities/basis to the new observation and reuses actual shared prices. CSV/XLSX equivalents deduplicate by observation identity and source content. Never invent trades or overwrite existing snapshots.
- Coverage-labeled native basis/gains subtotals, security allocation weights, recorded account histories, and price history drill-downs. Incomplete funding history must not be relabeled as investment return. Price-only trends and drawdowns must be labeled explicitly.
- Current-quote mode in the existing provider/price persistence path, under the existing lock and scheduler. Check US market sessions; share requests across pages/widgets; retain actual source timestamps and closing prices outside sessions.
- Investments page layouts through the existing dashboard layout mechanism, all twenty shared panels, native controls/scrollbars, short date ranges and responsive interactions.

Production verification must cover actual source files, repeated reconciliation, unchanged transactions/quantities/settings, real quote/history rows, independent saved page layouts, all panel types, and 320/390-pixel interactions. Empty charts and successful scheduler registration alone do not count as completed data integration.

The deployed owner session received HTTP 401 from the existing administrator-only global price refresh endpoint. Preserve that endpoint and its administrator guard. Add an authenticated, rate-limited refresh that validates requested securities against the owner's visible portfolios, includes verified benchmark listings, and invokes the same native services and locks. Long work uses the existing background-job response/polling mechanism. Successful writes notify existing SSE connections; the app invalidates shared investment caches once per event burst.

## Verified classification gap and reuse (November 21)

The supplied SPYG worksheet reports '-' for sector; imported N-PORT records contain issuer countries but no industry fields. The existing configured Yahoo client successfully returned AAPL equity identity, Technology sector and Consumer Electronics industry. This is an implementation probe of the existing provider, not a replacement pricing service.

Reuse the existing Yahoo client/factory, native Securities registry and stock-sync lock. Add only a nullable cached company-classification JSON field on Securities, with observed/attempt times and source URL. Fetch verified equity profiles at most weekly after native quote sync, cache failed attempts for a day, and share one request for duplicate provider identifiers. Fund, crypto and mismatched-identity responses are excluded. Fill absent exposure classifications through existing stable security identities; retain issuer-file classifications and genuine conflicts. Headquarters country is not issuer country and is not used as one. The field does not contain prices, holdings, transactions, cost basis or returns. Native migrations and validated backups remain required.

## Historical price representation repair

Verified native Yahoo history currently prefers `adjclose` while account replay multiplies historical shares and records dividends separately. Yahoo's own adjusted-close documentation states that field includes distribution and split adjustments (https://help.yahoo.com/kb/adjusted-close-sln28256.html). Reuse the existing SecurityPricing rows; add nullable raw-close and prior-close-reference metadata rather than a second price cache. The provider supplies split-adjusted `close` for continuous price-only charts, and restores original-share close units from its dated split events for native historical quantity valuation. Native quantity, transaction and FIFO calculations remain authoritative. Preserve non-provider/manual price records. Repair provider rows idempotently. Candle timestamps denote completed window closes; daily NAVs retain date-only precision. Late-evening broker observations are assigned to their Eastern date by an optional native replay adapter, preserving other native consumers' UTC default.
