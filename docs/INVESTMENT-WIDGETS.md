# Investment dashboard widget verification

The original twenty optional investment widgets are registered in MoneyMatter's existing
Add Widget interface. Registration does not change a saved or default dashboard.
Adapters use the shared `AnalyticsPanel` and either `useInvestmentAnalytics` or the focused `useInvestmentHistory` hook (benchmark uses both). No widget independently replays the financial ledger. See the current routing below.

Every type supports multiple instances identified by the existing `instanceId`,
with separate portfolio selections, saved date ranges and chart settings. The
existing editor handles adding, removing, moving, resizing and layout persistence.
Each widget's gear saves its own settings using that instance identity.

The automated lifecycle check for every row adds two instances, configures
different portfolios and periods, moves and resizes one, saves and reloads the
layout, changes one instance's settings, and removes only its sibling. It also
checks preservation of an existing Balance Trend widget.

| Widget                      | Implemented | Shared analytics adapter | Automated lifecycle | Shared panel connection | Desktop browser       | Mobile browser                    | Deployed/live verified |
| --------------------------- | ----------- | ------------------------ | ------------------- | ----------------------- | --------------------- | --------------------------------- | ---------------------- |
| Investment Overview         | Yes         | Yes                      | Passed              | Unit adapter passed     | Fixture + live passed | Fixture + live passed (390 / 320) | Verified 9c4b17cb5     |
| Portfolio Performance       | Yes         | Yes                      | Passed              | Unit adapter passed     | Fixture + live passed | Fixture + live passed (390 / 320) | Verified 9c4b17cb5     |
| Value vs. Invested Capital  | Yes         | Yes                      | Passed              | Unit adapter passed     | Fixture + live passed | Fixture + live passed (390 / 320) | Verified 9c4b17cb5     |
| Benchmark Comparison        | Yes         | Yes                      | Passed              | Unit adapter passed     | Fixture + live passed | Fixture + live passed (390 / 320) | Verified 9c4b17cb5     |
| Investment Allocation       | Yes         | Yes                      | Passed              | Unit adapter passed     | Fixture + live passed | Fixture + live passed (390 / 320) | Verified 9c4b17cb5     |
| Portfolio Heatmap / Treemap | Yes         | Yes                      | Passed              | Unit adapter passed     | Fixture + live passed | Fixture + live passed (390 / 320) | Verified 9c4b17cb5     |
| Combined Holdings           | Yes         | Yes                      | Passed              | Unit adapter passed     | Fixture + live passed | Fixture + live passed (390 / 320) | Verified 9c4b17cb5     |
| Underlying Company Exposure | Yes         | Yes                      | Passed              | Unit adapter passed     | Fixture + live passed | Fixture + live passed (390 / 320) | Verified 9c4b17cb5     |
| Sector Allocation           | Yes         | Yes                      | Passed              | Unit adapter passed     | Fixture + live passed | Fixture + live passed (390 / 320) | Verified 9c4b17cb5     |
| Geographical Allocation     | Yes         | Yes                      | Passed              | Unit adapter passed     | Fixture + live passed | Fixture + live passed (390 / 320) | Verified 9c4b17cb5     |
| Dividend Income             | Yes         | Yes                      | Passed              | Unit adapter passed     | Fixture + live passed | Fixture + live passed (390 / 320) | Verified 9c4b17cb5     |
| Dividend Calendar           | Yes         | Yes                      | Passed              | Unit adapter passed     | Fixture + live passed | Fixture + live passed (390 / 320) | Verified 9c4b17cb5     |
| Best & Worst Performers     | Yes         | Yes                      | Passed              | Unit adapter passed     | Fixture + live passed | Fixture + live passed (390 / 320) | Verified 9c4b17cb5     |
| Portfolio Concentration     | Yes         | Yes                      | Passed              | Unit adapter passed     | Fixture + live passed | Fixture + live passed (390 / 320) | Verified 9c4b17cb5     |
| Realized & Unrealized Gains | Yes         | Yes                      | Passed              | Unit adapter passed     | Fixture + live passed | Fixture + live passed (390 / 320) | Verified 9c4b17cb5     |
| ETF Overlap                 | Yes         | Yes                      | Passed              | Unit adapter passed     | Fixture + live passed | Fixture + live passed (390 / 320) | Verified 9c4b17cb5     |
| Investment Contributions    | Yes         | Yes                      | Passed              | Unit adapter passed     | Fixture + live passed | Fixture + live passed (390 / 320) | Verified 9c4b17cb5     |
| Risk & Drawdown             | Yes         | Yes                      | Passed              | Unit adapter passed     | Fixture + live passed | Fixture + live passed (390 / 320) | Verified 9c4b17cb5     |
| Portfolio Comparison        | Yes         | Yes                      | Passed              | Unit adapter passed     | Fixture + live passed | Fixture + live passed (390 / 320) | Verified 9c4b17cb5     |
| Market Data Health          | Yes         | Yes                      | Passed              | Unit adapter passed     | Fixture + live passed | Fixture + live passed (390 / 320) | Verified 9c4b17cb5     |

Desktop (1440 pixels, dark theme, actual mouse) and mobile (390 and 320 pixels,
light theme, actual touch) exercised every row using an explicitly synthetic
analytics fixture. Each run added all twenty through the native Add Widget UI,
configured a portfolio and date range in every gear, moved and resized every
widget, reloaded, and removed every investment widget. A second Allocation
instance retained separate settings. Browser settings writes were intercepted
in memory; the stored production dashboard fingerprint was unchanged. These
sixty browser lifecycles produced no browser errors or financial writes.
The private combined trace is `private/investment-widget-browser/fixture-results.json`.
All twenty widgets were then verified against the deployed application at commit
`39e43789d` using actual imported analytics, with the same full lifecycle at
1440, 390 and 320 pixels. Real-data GET requests reached the shared service;
only browser settings writes were simulated. The separate trace is
`private/investment-widget-browser/live-results.json`. Every viewport retained
the original production dashboard, reported zero browser errors and financial
writes, and fit without horizontal page overflow. Missing or partial data remains
subject to the shared service quality status.

The final release `9c4b17cb5` passed a targeted real-data smoke check at all three
viewports: twenty widget types and twenty-two instances, including three
independent Allocation configurations, connected to their shared panels with
successful analytics responses. There were no browser errors, horizontal page
overflow or financial writes, and the saved production dashboard remained
unchanged. Prior lifecycle and isolated server-persistence evidence remains
applicable; those full checks were not unnecessarily repeated. Current-release
evidence: `private/investment-widget-browser/current-release-smoke.json`.

Actual server persistence was also verified on an isolated copy of the restored
verification database. The existing ARM64 backend ran with its supported test
mode, offline mode, a separate temporary Redis container and no published ports.
An explicit database-name guard ran before every write. All twenty widget types
and twenty-one instances persisted through the authenticated settings API, matched
direct PostgreSQL readback, and survived a new authenticated session. Changing
the second Allocation instance preserved its sibling and every other settings
field. A manual fund snapshot retained 50% partial coverage; repeating it inserted
no duplicate, and conflicting content, excess weights and duplicate identities
were rejected with HTTP 422. All twenty-two protected financial tables and the
original restored database remained unchanged. Temporary test containers were
removed. The production database received no writes from this verification.
Evidence: `private/investment-widget-server-verification.json`.

Financial calculation verification belongs to the shared analytics engine. A
connected widget still reports the engine's partial/unavailable source status;
registration or a passing UI adapter test does not establish live fund data,
valid historical returns or sufficient price coverage.

Automated checks:

- `investment-widgets.spec.ts`: twenty complete native-editor lifecycles,
  preservation of default/existing dashboards, independent configurations and
  all thirteen allocation modes.
- `investment-widget.spec.ts`: each adapter's query, panel kind and reactive
  portfolio settings; instance-specific chart and gear persistence; loading,
  retry, empty and failed-save states.
- `investment-widget-settings.spec.ts`: portfolio selection, thirteen modes,
  custom date validation, multiple benchmark symbols and heatmap controls.

On a Node 26 development host, run Vitest with
`NODE_OPTIONS=--no-experimental-webstorage` so jsdom supplies browser storage.
The repository's intended runtime remains the Node version in `package.json`.


## Current backend routing and performance header (2026-11-25)

The original twenty widgets and the new dedicated underlying allocation widget use the shared backend. The original verification above refers to earlier release commits, not automatic verification of the latest optimizations.

| Widget(s) | Backend path / section |
| --- | --- |
| Portfolio Performance, Value vs. Invested Capital, Portfolio Comparison | Focused history endpoint |
| Investment Overview, Realized & Unrealized Gains | Read model: overview |
| Combined Holdings, Best & Worst Performers, direct Portfolio Heatmap | Read model: holdings |
| Investment Allocation, Investment Allocation – Underlying Companies, Sector Allocation, Geographical Allocation, Underlying Company Exposure, Portfolio Concentration, underlying Heatmap | Read model: exposure |
| Dividend Income, Dividend Calendar | Read model: dividends |
| Benchmark Comparison | Read model: benchmarks + focused history |
| Investment Contributions | Read model: contributions |
| ETF Overlap | Read model: overlap |
| Risk & Drawdown | Read model: risk |
| Market Data Health | Read model: health |

Sections are response projections, not independent replay jobs. Identical scope/section requests share client query state and backend projection work; different sections can reuse the same persisted result. Current heatmap and standard position periods use the undated base where supported; custom direct heatmap/performer dates use a sparse range overlay when the matching base exists. Underlying heatmap requests exposure without a custom position range. See [read-model architecture](INVESTMENT-READ-MODEL.md) and [focused history](INVESTMENT-HISTORY-ARCHITECTURE.md).

Loading states permit dashboard scroll chaining rather than trapping scrolling in an investment widget (28ebe2a); pending/retry remains scoped to the widget. This does not eliminate cold computation time.

Portfolio Performance (ec1e029): the dashboard period controls (1D / 1M when selected) show the selected-period signed dollar gain and percent return inline, with the $ / +/- / % chart-mode segmented control before the open-page arrow and gear. The modes display account value, dollar gain/loss or percent return and persist per instance. The combined performance widget always requests capital/return evidence and the selected opening date, regardless of chart mode; switching modes does not issue a distinct history query. `selectedPerformanceSummary` selects the latest supported observation in the requested dates, rejects mismatched opening dates, and exposes partial/missing evidence instead of fabricated returns. Percentage returns use the backend Modified Dietz series, not simple change in account balance. The shared summary is not duplicated in the widget body. A regression test exists in `investment-widget.spec.ts`; latest compilation and browser validation were not established by the supplied deployment record.

### Dedicated underlying-company allocation

The main Dashboard Add Widget catalog now also offers `investment-allocation-underlying` (Investment Allocation – Underlying Companies), bringing the registry to 21 investment widget types. It is a fixed current-exposure doughnut using the existing allocation drill-down and `exposure` read-model section, with the same portfolio settings, resize and instance persistence as Investment Allocation. It aggregates direct and indirect company exposure from the backend, retains unknown composition amounts and does not run an independent calculation. The existing direct-holdings widget and saved layouts are unchanged. The new tests cover registry lifecycle, scope/section routing and the chart's underlying data including unknown exposure; run frontend tests and verify on the deployed dashboard before marking it live.
