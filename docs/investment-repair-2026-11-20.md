# Investments repair: reuse and evidence

The current consolidated adapter discards supported account values when any selected account has unknown cash, basis or incomplete opening history. It also requires simultaneous broker snapshots for historical returns and does not request current equity quotes. These are verified missing capabilities in the analytics integration, not reasons to replace portfolio accounting.

Reuse `getHoldingValues`, `getPortfolioSummary`, `computeHoldingTotals`, the native FIFO gains calculator, broker observations, `SecurityPricing`, composite providers, native historical price sync, cron wrappers, Vue Query, dashboard grid/layout persistence, scrollbar and chart interaction components. Preserve hidden-portfolio exclusion independently of net-worth inclusion.

Add only the following missing integration behavior:

- Immutable dated positions/basis observations in the existing broker snapshots. A basis-only export has null market values, cash and account total; it never creates a quote. The native holdings replay anchors quantities/basis to the new observation and reuses actual shared prices. CSV/XLSX equivalents deduplicate by observation identity and source content. Never invent trades or overwrite existing snapshots.
- Coverage-labeled native basis/gains subtotals, security allocation weights, recorded account histories, and price history drill-downs. Incomplete funding history must not be relabeled as investment return. Price-only trends and drawdowns must be labeled explicitly.
- Current-quote mode in the existing provider/price persistence path, under the existing lock and scheduler. Check US market sessions; share requests across pages/widgets; retain actual source timestamps and closing prices outside sessions.
- Investments page layouts through the existing dashboard layout mechanism, all twenty shared panels, native controls/scrollbars, short date ranges and responsive interactions.

Production verification must cover actual source files, repeated reconciliation, unchanged transactions/quantities/settings, real quote/history rows, independent saved page layouts, all panel types, and 320/390-pixel interactions. Empty charts and successful scheduler registration alone do not count as completed data integration.
