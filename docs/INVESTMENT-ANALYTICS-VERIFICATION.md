# Investment analytics verification — November 20, 2026

Current application release: `bf1af9a16`, deployed using the existing `dev` checkout, prebuilt helpers, SSH alias and compose environment. All six existing services reported healthy. No infrastructure was reconfigured.

## Actual financial data

The native records supply 79 consolidated holdings. Robinhood CSV and XLSX evidence matched independently and current read-only brokerage positions verified the source quantities. The integration restored 15 missing account holdings, reconciled four changed quantities and imported 45 reported basis amounts. Repeating both immutable brokerage imports created zero additional snapshots, source events or trades. VXRT tax basis remains unknown; its reported display average is separately labeled. IDEXQ remains held for instrument-identity review. No investment trades were invented from current positions.

Production readback after historical backfill showed 79/79 holdings priced and supported daily changes, 1,574 dated known account values, four benchmarks with 1,256 observations each, and 104 price-risk observations covering 99.545566% of known holding value. Dated fund coverage was 99.865821% by fund value at this readback. See [fund completion matrix](INVESTMENT-COMPOSITION-COMPLETION.md) for source dates, original row counts and restrictions.

Recorded account values and known basis/gains are displayed when full consolidated totals cannot be established. Missing cash, opening positions and funding prevent verified complete account TWR/XIRR. The current fixed-quantity price-risk fallback is explicitly labeled price-only and excludes trades, cash and distributions. It is not presented as historical account performance. Partial series preserve gaps; current holdings are never copied into years without position evidence.

## Validation

Frontend unit suite: 83 checks passed. Backend analytics/session/daily-attribution suite: 54 checks passed, including prior closes across holidays/DST, net purchases, fees, partial and full sales, and inconsistent opening positions. Earlier composition/schema/analytics validation passed 98 checks. Frontend and backend production builds passed, and native commit lint/translation checks passed.

The five Investments pages use the existing Dashboard layout components with independent settings namespaces, and the same twenty investment widget definitions remain available on the main Dashboard. Holdings use continuous native scroll areas; security histories reuse native price storage. Native open-page arrows, scrollbar components and settings controls are reused.

Browser verification is recorded separately under `private/investment-repair/`. Desktop and narrow-width browser checks are in progress; a rendered or empty widget alone is not counted as financial feature completion. Natural market-open five-minute refresh remains unobserved because verification occurs after trading hours. Scheduled composition worker execution was verified manually in deployment, while the next natural 07:15 trigger has not yet been witnessed.
