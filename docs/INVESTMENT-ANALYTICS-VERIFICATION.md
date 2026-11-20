# Consolidated investment analytics implementation and verification

This extends the existing MoneyMatter investment system on `dev`. Portfolio
management remains under Accounts. The analytics layer must consume the existing
holdings, portfolio summary, FIFO gains, price history and brokerage evidence;
it must not introduce a competing financial ledger or cost basis calculation.

## Work ownership and sequence

1. Investment engine: document existing service reuse, aggregate their results,
   add missing consolidated analytics, fund snapshots, look-through and overlap.
2. Investments UI: five routes and native expandable navigation; shared charts,
   filters, tables, compact quality states and drill-downs.
3. Dashboard widgets: all twenty optional widget types, shared panels and query,
   independent instance settings and existing dashboard lifecycle.
4. Integration: calculation review, actual-record readback, browser mouse/touch
   verification, builds, preservation fingerprints, backup and Pi deployment.

The existing SSH alias is `cardgames-pi`; the Pi checkout is
`/home/rayden/personal-finance-dashboard`. Use `deploy/README.md` and the prebuilt
artifact helpers. Preserve services, volumes, secrets, networking and schedules.

## Status conventions

Each deliverable records implementation (I), shared data connection (S), financial
verification (F), desktop (D), mobile (M), dashboard lifecycle (W), deployment (P)
and running application verification (L). `pending` is not a completion claim.
`partial` identifies a documented gap; `n/a` applies only when a check is irrelevant.
External coverage must distinguish interface, calculation engine, source
availability, partial coverage and live verification.

## Page completion matrix

| Page                  | I       | S       | F       | D       | M       | W   | P       | L       |
| --------------------- | ------- | ------- | ------- | ------- | ------- | --- | ------- | ------- |
| Overview              | pending | pending | pending | pending | pending | n/a | pending | pending |
| Performance           | pending | pending | pending | pending | pending | n/a | pending | pending |
| Holdings              | pending | pending | pending | pending | pending | n/a | pending | pending |
| Allocation & Exposure | pending | pending | pending | pending | pending | n/a | pending | pending |
| Dividends             | pending | pending | pending | pending | pending | n/a | pending | pending |

## Mandatory widget completion matrix

| Widget                      | I       | S       | F       | D       | M       | W       | P       | L       |
| --------------------------- | ------- | ------- | ------- | ------- | ------- | ------- | ------- | ------- |
| Investment Overview         | pending | pending | pending | pending | pending | pending | pending | pending |
| Portfolio Performance       | pending | pending | pending | pending | pending | pending | pending | pending |
| Value vs. Invested Capital  | pending | pending | pending | pending | pending | pending | pending | pending |
| Benchmark Comparison        | pending | pending | pending | pending | pending | pending | pending | pending |
| Investment Allocation       | pending | pending | pending | pending | pending | pending | pending | pending |
| Portfolio Heatmap / Treemap | pending | pending | pending | pending | pending | pending | pending | pending |
| Combined Holdings           | pending | pending | pending | pending | pending | pending | pending | pending |
| Underlying Company Exposure | pending | pending | pending | pending | pending | pending | pending | pending |
| Sector Allocation           | pending | pending | pending | pending | pending | pending | pending | pending |
| Geographical Allocation     | pending | pending | pending | pending | pending | pending | pending | pending |
| Dividend Income             | pending | pending | pending | pending | pending | pending | pending | pending |
| Dividend Calendar           | pending | pending | pending | pending | pending | pending | pending | pending |
| Best & Worst Performers     | pending | pending | pending | pending | pending | pending | pending | pending |
| Portfolio Concentration     | pending | pending | pending | pending | pending | pending | pending | pending |
| Realized & Unrealized Gains | pending | pending | pending | pending | pending | pending | pending | pending |
| ETF Overlap                 | pending | pending | pending | pending | pending | pending | pending | pending |
| Investment Contributions    | pending | pending | pending | pending | pending | pending | pending | pending |
| Risk & Drawdown             | pending | pending | pending | pending | pending | pending | pending | pending |
| Portfolio Comparison        | pending | pending | pending | pending | pending | pending | pending | pending |
| Market Data Health          | pending | pending | pending | pending | pending | pending | pending | pending |

## Feature and calculation checklist

- [ ] Document actual reuse of `getHoldingValues`, `getPortfolioSummary`, gains,
      models, historical prices and brokerage records before architecture changes.
- [ ] All, individual and multiple portfolios; brokerage and account group filters.
- [ ] Hidden portfolio analytics eligibility remains independent of net worth.
- [ ] Consolidated totals never sum linked SimpleFIN balances onto detailed assets.
- [ ] Remaining basis, contributions, withdrawals, net invested capital and gains
      remain distinct; unavailable values never appear as verified zero.
- [ ] Security identity uses stable identifiers, currency, exchange and type.
- [ ] Aggregate valid basis and corresponding quantity for weighted average cost.
- [ ] Fractional shares and crypto precision; explicit currency conversion gaps.
- [ ] Realized/unrealized gains reuse authoritative portfolio services.
- [ ] Internal transfers cancel relative to the selected set; outside flows remain.
- [ ] Reinvestment, fees, splits, mergers and missing opening history quality gates.
- [ ] Actual historical prices/snapshots only; gaps remain gaps.
- [ ] Dollar gains, total return, TWR, XIRR, daily/YTD/lifetime and annualization
      have verified calculations or specific unavailable reasons.
- [ ] Benchmark series share start date and scale; total-return versus price-only
      provenance explicit; multiple benchmarks and custom security selection.
- [ ] Holdings expand by account; source dates, search, sort and links work.
- [ ] Treemap direct/underlying modes, size, color, grouping and drill-down.
- [ ] One doughnut handles all thirteen allocation modes with unknown categories.
- [ ] Fund snapshots retain effective/retrieval dates, source and coverage.
- [ ] Manual CSV/JSON fund holdings import validates identity/weights/provenance.
- [ ] Recursive look-through prevents cycles and wrapper double counting.
- [ ] Partial holdings retain residual Unknown without renormalization.
- [ ] Direct plus indirect exposure and contributing fund drill-down reconcile.
- [ ] Issuer-country geography and explicit classification taxonomy.
- [ ] Pairwise overlap is sum of minimum comparable weights; shared positions,
      coverage dates and unique holdings remain inspectable.
- [ ] Actual dividends and interest; reinvestment status separate from contributions.
- [ ] Monthly/quarterly/yearly dividends and recorded/forecast calendar distinction.
- [ ] Yield, yield on cost and future income only when supported.
- [ ] Concentration, volatility, drawdown and portfolio comparisons quality-gated.
- [ ] Price refresh reuses existing shared endpoint/cache/schedules.
- [ ] Health explains basis, historical, price, holdings and reconciliation coverage.

## Interaction checklist (pages and matching widgets)

- [ ] One clickable Investments parent follows native Accounts expansion.
- [ ] Every route and existing individual portfolio route remains available.
- [ ] Mouse tracks continuously; nearest point, dots and crosshairs work.
- [ ] Stacked bars select the segment under the pointer.
- [ ] Tooltips use native surface/positioning and stay within viewport.
- [ ] Legends toggle/highlight series and allocation categories.
- [ ] Presets 1M/3M/6M/YTD/1Y/2Y/5Y/MAX, exact dates, period arrows and calendar.
- [ ] Aggregation is independent of selected date range; no future navigation.
- [ ] Mobile tap selects/changes; outside tap, scroll and Escape dismiss.
- [ ] Touch does not block normal scrolling.
- [ ] Test 1440, 390 and 320 pixel layouts, both themes and no page overflow.
- [ ] Every widget: add/remove/resize/reorder/configure/save/reload.
- [ ] Multiple instances retain different portfolio/date/visualization settings.
- [ ] Loading, error, empty and unavailable states are connected and tested.

## Deployment and preservation checklist

- [x] Read existing deployment docs and scripts; existing status command passed.
- [x] Initial finance stack: six healthy services; reuse working infrastructure.
- [ ] Capture original financial table and Income/payroll fingerprints privately.
- [ ] Focused calculation, look-through, widget and interaction checks pass.
- [ ] Frontend/backend typechecks, scoped lint and production builds pass.
- [ ] Back up production before migration; validate restore in separate database.
- [ ] Additive migration tested without rewriting existing financial records.
- [ ] Build Windows artifacts, package minimal contexts, use existing ARM64 helpers.
- [ ] Deploy consolidated checkpoint; confirm six healthy finance services.
- [ ] Original financial tables match expected preservation fingerprints.
- [ ] Existing Income/dashboard/net worth/SimpleFIN behavior and six-hour sync retained.
- [ ] Existing other Pi services remain active and unaffected.
- [ ] Deployed pages/widgets verified with actual records and mouse/mobile touch.
- [ ] Local dev, origin/dev and Pi commit synchronized; no sensitive artifacts tracked.

## Evidence and unresolved limitations

Sensitive records, credentials, browser evidence and financial fingerprints belong
in the ignored `private/` directory. Record counts and test summaries may be
reported without exposing account numbers or personal financial amounts.

Implementation is in progress. No pending row is verified or complete.
