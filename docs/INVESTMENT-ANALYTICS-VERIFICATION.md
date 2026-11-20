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
`partial` identifies a documented source or capability gap; `n/a` applies only when a check is irrelevant.
External coverage must distinguish interface, calculation engine, source
availability, partial coverage and live verification.

## Page completion matrix

| Page                  | I   | S   | F                                   | D      | M      | W   | P   | L      |
| --------------------- | --- | --- | ----------------------------------- | ------ | ------ | --- | --- | ------ |
| Overview              | yes | yes | partial source                      | passed | passed | n/a | yes | passed |
| Performance           | yes | yes | partial history                     | passed | passed | n/a | yes | passed |
| Holdings              | yes | yes | native parity passed; basis partial | passed | passed | n/a | yes | passed |
| Allocation & Exposure | yes | yes | engine passed; composition missing  | passed | passed | n/a | yes | passed |
| Dividends             | yes | yes | recorded passed; source partial     | passed | passed | n/a | yes | passed |

## Mandatory widget completion matrix

| Widget                      | I   | S   | F                                       | D      | M      | W      | P   | L      |
| --------------------------- | --- | --- | --------------------------------------- | ------ | ------ | ------ | --- | ------ |
| Investment Overview         | yes | yes | partial source                          | passed | passed | passed | yes | passed |
| Portfolio Performance       | yes | yes | partial history                         | passed | passed | passed | yes | passed |
| Value vs. Invested Capital  | yes | yes | partial history/flows                   | passed | passed | passed | yes | passed |
| Benchmark Comparison        | yes | yes | engine passed; live unavailable         | passed | passed | passed | yes | passed |
| Investment Allocation       | yes | yes | direct passed; underlying partial       | passed | passed | passed | yes | passed |
| Portfolio Heatmap / Treemap | yes | yes | direct passed; period coverage explicit | passed | passed | passed | yes | passed |
| Combined Holdings           | yes | yes | native parity passed; basis partial     | passed | passed | passed | yes | passed |
| Underlying Company Exposure | yes | yes | engine passed; composition missing      | passed | passed | passed | yes | passed |
| Sector Allocation           | yes | yes | engine passed; classifications missing  | passed | passed | passed | yes | passed |
| Geographical Allocation     | yes | yes | engine passed; classifications missing  | passed | passed | passed | yes | passed |
| Dividend Income             | yes | yes | recorded passed; source partial         | passed | passed | passed | yes | passed |
| Dividend Calendar           | yes | yes | recorded passed; future unavailable     | passed | passed | passed | yes | passed |
| Best & Worst Performers     | yes | yes | native basis / price-only periods       | passed | passed | passed | yes | passed |
| Portfolio Concentration     | yes | yes | partial exposure / denominator          | passed | passed | passed | yes | passed |
| Realized & Unrealized Gains | yes | yes | native outputs passed; history partial  | passed | passed | passed | yes | passed |
| ETF Overlap                 | yes | yes | engine passed; composition missing      | passed | passed | passed | yes | passed |
| Investment Contributions    | yes | yes | recorded flows passed; history partial  | passed | passed | passed | yes | passed |
| Risk & Drawdown             | yes | yes | engine passed; live unavailable         | passed | passed | passed | yes | passed |
| Portfolio Comparison        | yes | yes | recorded dollars; returns unavailable   | passed | passed | passed | yes | passed |
| Market Data Health          | yes | yes | passed                                  | passed | passed | passed | yes | passed |

## Feature and calculation checklist

- [x] Document actual reuse of `getHoldingValues`, `getPortfolioSummary`, gains,
      models, historical prices and brokerage records before architecture changes.
- [x] All, individual and multiple portfolios; brokerage and account group filters.
- [x] Hidden portfolio analytics eligibility remains independent of net worth.
- [x] Consolidated totals never sum linked SimpleFIN balances onto detailed assets.
- [x] Remaining basis, contributions, withdrawals, net invested capital and gains
      remain distinct; unavailable values never appear as verified zero.
- [x] Security identity uses stable identifiers, currency, exchange and type.
- [x] Aggregate valid basis and corresponding quantity for weighted average cost.
- [x] Fractional shares and crypto precision; explicit currency conversion gaps.
- [x] Realized/unrealized gains reuse authoritative portfolio services.
- [x] Internal transfers cancel relative to the selected set; outside flows remain.
- [x] Reinvestment, fees, splits, mergers and missing opening history quality gates.
- [x] Actual historical prices/snapshots only; gaps remain gaps.
- [x] Dollar gains, total return, TWR, XIRR, daily/YTD/lifetime and annualization
      have verified calculations or specific unavailable reasons.
- [x] Benchmark series share start date and scale; total-return versus price-only
      provenance explicit; multiple benchmarks and custom security selection.
- [x] Holdings expand by account; source dates, search, sort and links work.
- [x] Treemap direct/underlying modes, size, color, grouping and drill-down.
- [x] One doughnut handles all thirteen allocation modes with unknown categories.
- [x] Fund snapshots retain effective/retrieval dates, source and coverage.
- [x] Manual CSV/JSON fund holdings import validates identity/weights/provenance.
- [x] Recursive look-through prevents cycles and wrapper double counting.
- [x] Partial holdings retain residual Unknown without renormalization.
- [x] Direct plus indirect exposure and contributing fund drill-down reconcile.
- [x] Issuer-country geography and explicit classification taxonomy.
- [x] Pairwise overlap is sum of minimum comparable weights; shared positions,
      coverage dates and unique holdings remain inspectable.
- [x] Recorded dividends; unavailable interest/reinvestment attribution stays explicit and separate from contributions.
- [x] Monthly/quarterly/yearly dividends and recorded/forecast calendar distinction.
- [x] Yield, yield on cost and future income only when supported.
- [x] Concentration, volatility, drawdown and portfolio comparisons quality-gated.
- [x] Price refresh reuses existing shared endpoint/cache/schedules.
- [x] Health explains basis, historical, price, holdings and reconciliation coverage.

## Interaction checklist (pages and matching widgets)

- [x] One clickable Investments parent follows native Accounts expansion.
- [x] Every route and existing individual portfolio route remains available.
- [x] Mouse tracks continuously; nearest point, dots and crosshairs work.
- [x] Stacked bars select the segment under the pointer.
- [x] Tooltips use native surface/positioning and stay within viewport.
- [x] Legends toggle/highlight series and allocation categories.
- [x] Presets 1M/3M/6M/YTD/1Y/2Y/5Y/MAX, exact dates, period arrows and calendar.
- [x] Aggregation is independent of selected date range; no future navigation.
- [x] Mobile tap selects/changes; outside tap, scroll and Escape dismiss.
- [x] Touch does not block normal scrolling.
- [x] Test 1440, 390 and 320 pixel layouts, both themes and no page overflow.
- [x] Every widget: add/remove/resize/reorder/configure/save/reload.
- [x] Multiple instances retain different portfolio/date/visualization settings.
- [x] Loading, error, empty and unavailable states are connected and tested.

## Deployment and preservation checklist

- [x] Read existing deployment docs and scripts; existing status command passed.
- [x] Initial finance stack: six healthy services; reuse working infrastructure.
- [x] Capture original financial table and Income/payroll fingerprints privately.
- [x] Focused calculation, look-through, widget and interaction checks pass.
- [x] Frontend/backend typechecks, scoped lint and production builds pass.
- [x] Back up production before migration; validate restore in separate database.
- [x] Additive migration tested without rewriting existing financial records.
- [x] Build Windows artifacts, package minimal contexts, use existing ARM64 helpers.
- [x] Deploy consolidated checkpoint; confirm six healthy finance services.
- [x] Original financial tables match expected preservation fingerprints.
- [x] Existing Income/dashboard/net worth/SimpleFIN behavior and six-hour sync retained.
- [x] Existing other Pi services remain active and unaffected.
- [x] Deployed pages/widgets verified with actual records and mouse/mobile touch.
- [ ] Final local dev, origin/dev and Pi commit synchronization after verification documentation.

## Evidence and unresolved limitations

Sensitive records, credentials, browser evidence and financial fingerprints belong
in the ignored `private/` directory. Record counts and test summaries may be
reported without exposing account numbers or personal financial amounts.

## Release verification

The five pages and twenty optional widgets are deployed and connected to the
shared analytics service. This does not mean every external data source or
advanced live calculation is operational; partial coverage remains explicit.

- Backend: 110 distinct targeted checks passed across checkpoints, including
  79 existing native calculation/history checks. The final frontend capability
  suite passed 52 checks; the dedicated widget/layout/settings suite also passed
  62 checks across checkpoints (these frontend groups overlap). Both typechecks, production builds
  and lint/i18n checks passed, with lint warnings retained.
- All five pages passed actual-data browser checks at 1440, 390 and 320 pixels.
  Populated synthetic checks additionally verified line tracking, legends,
  custom dates, arrows, stacked segments, allocation modes, treemap inspection,
  overlap details and import preview validation.
- All twenty widgets passed sixty complete actual-data browser lifecycles and
  sixty populated-fixture lifecycles: add/configure/move/resize/reload/remove,
  plus independently configured duplicate instances. Production dashboard
  settings remained unchanged.
- Actual server persistence was verified in a guarded, isolated database
  derived from the restored backup: every widget type, independent instances,
  direct database readback and a new authenticated session agreed. A partial
  fund import, identical repeat, immutable conflict and invalid inputs were
  tested through the real API. The original restored database and all inspected
  financial tables remained unchanged. Temporary test containers were removed.
- Eighteen live API checks verified native output parity, selections, ownership,
  invalid import rejection, exact quantities, valid weighted basis, source
  dates and partial-value semantics. A separate actual-data browser proof at
  all three widths verified every Direct Holdings identifier, actual fund
  tickers, look-through Unknown residuals, mode restoration, account links,
  treemap modes and the complete MAX range.
- Existing Actual Income, Projected Income and Personal Net Worth passed six
  real-data desktop/mobile cases, including native chart selection/dismissal.
  Saved Income and payroll records remained identical.
- The backup was restored into a separate database and the additive migration
  passed there before production. All 22 inspected tables matched restoration
  versus production. Relative to the initial capture, 21 tables matched exactly;
  Securities differences were confined to normal `pricingLastSyncedAt` and
  `updatedAt` metadata. Existing financial records and source evidence survived.
- All six finance services are healthy; Minecraft, WireGuard and the existing
  bank timer remained active. Existing stock and crypto scheduler startup was
  verified. Networking, credentials, persistent volumes and schedules were
  preserved. The established helper's dependency guard stayed enabled: a
  lockfile mismatch was proved to contain only frontend manifest metadata;
  every resolved dependency and backend/shared manifest matched the ARM runtime.
  That runtime's exact dependency manifest was retained without reinstalling
  packages.

## Remaining coverage and capability limits

- Automatic fund-composition/classification integration is not connected. The
  bounded SEC registry feasibility request received HTTP 403 and stopped after
  one request. The installed Yahoo top-holdings contract does not guarantee a
  composition effective date or strong identifiers. Dated manual CSV/JSON import
  and the exposure/overlap engines are verified; live constituent weights and
  unknown classifications are never invented. See [the provider audit](INVESTMENT-MARKET-DATA.md).
- Opening/funding/corporate-action history, cash and basis coverage are
  incomplete. Known subtotals remain partial. Unsupported totals, TWR, XIRR,
  YTD/lifetime returns and risk remain unavailable. Exact-boundary calculations
  are tested; the current sources lack the required boundary observations.
- Benchmarks use stored price-only data when common verified return history
  exists. Total-return benchmark data is not connected. Portfolio Comparison
  shows labelled recorded dollar balances; normalized portfolio returns remain
  unavailable for current imported history.
- Overlap includes recursive shared companies, known unique constituents, and
  weighted sector/issuer-country comparisons. Unknown or incompatible taxonomy
  coverage is withheld. Performer rankings support native unrealized return and
  six selectable modes including available daily/weekly/monthly/YTD/one-year
  price-only changes, with unknown observations excluded.
- Historical allocation changes are not visualized. Dated composition storage
  exists, but no historical composition coverage or allocation timeline is
  operational.
- Separate interest attribution, verified dividend-reinvestment flags, indicated
  yields and forecast schedules are unavailable. Recorded income, period
  aggregation, security/portfolio breakdowns and the calendar work. Upcoming
  announced/estimated calendar interfaces are implemented without inventing
  future source records. Dividend growth requires complete comparable years.
- Historical foreign-currency conversions with missing evidence are withheld.
  Current conversions reuse native behavior. The existing native historical
  helper's whole-dollar rounding remains unchanged and disclosed.

Detailed source inventories, financial comparisons, backup information and
browser evidence remain in ignored `private/`. No financial values, account
identifiers, credentials, exports or screenshots are tracked.
