# Investment dashboard widget verification

All twenty optional investment widgets are registered in MoneyMatter's existing
Add Widget interface. Registration does not change a saved or default dashboard.
Each adapter uses `useInvestmentAnalytics` and the same `AnalyticsPanel` as the
Investments pages. No widget computes financial values independently.

Every type supports multiple instances identified by the existing `instanceId`,
with separate portfolio selections, saved date ranges and chart settings. The
existing editor handles adding, removing, moving, resizing and layout persistence.
Each widget's gear saves its own settings using that instance identity.

The automated lifecycle check for every row adds two instances, configures
different portfolios and periods, moves and resizes one, saves and reloads the
layout, changes one instance's settings, and removes only its sibling. It also
checks preservation of an existing Balance Trend widget.

| Widget                      | Implemented | Shared analytics adapter | Automated lifecycle | Shared panel connection | Desktop browser | Mobile browser | Deployed/live verified |
| --------------------------- | ----------- | ------------------------ | ------------------- | ----------------------- | --------------- | -------------- | ---------------------- |
| Investment Overview         | Yes         | Yes                      | Passed              | Unit adapter passed     | Fixture passed  | Pending        | Pending                |
| Portfolio Performance       | Yes         | Yes                      | Passed              | Unit adapter passed     | Fixture passed  | Pending        | Pending                |
| Value vs. Invested Capital  | Yes         | Yes                      | Passed              | Unit adapter passed     | Fixture passed  | Pending        | Pending                |
| Benchmark Comparison        | Yes         | Yes                      | Passed              | Unit adapter passed     | Fixture passed  | Pending        | Pending                |
| Investment Allocation       | Yes         | Yes                      | Passed              | Unit adapter passed     | Fixture passed  | Pending        | Pending                |
| Portfolio Heatmap / Treemap | Yes         | Yes                      | Passed              | Unit adapter passed     | Fixture passed  | Pending        | Pending                |
| Combined Holdings           | Yes         | Yes                      | Passed              | Unit adapter passed     | Fixture passed  | Pending        | Pending                |
| Underlying Company Exposure | Yes         | Yes                      | Passed              | Unit adapter passed     | Fixture passed  | Pending        | Pending                |
| Sector Allocation           | Yes         | Yes                      | Passed              | Unit adapter passed     | Fixture passed  | Pending        | Pending                |
| Geographical Allocation     | Yes         | Yes                      | Passed              | Unit adapter passed     | Fixture passed  | Pending        | Pending                |
| Dividend Income             | Yes         | Yes                      | Passed              | Unit adapter passed     | Fixture passed  | Pending        | Pending                |
| Dividend Calendar           | Yes         | Yes                      | Passed              | Unit adapter passed     | Fixture passed  | Pending        | Pending                |
| Best & Worst Performers     | Yes         | Yes                      | Passed              | Unit adapter passed     | Fixture passed  | Pending        | Pending                |
| Portfolio Concentration     | Yes         | Yes                      | Passed              | Unit adapter passed     | Fixture passed  | Pending        | Pending                |
| Realized & Unrealized Gains | Yes         | Yes                      | Passed              | Unit adapter passed     | Fixture passed  | Pending        | Pending                |
| ETF Overlap                 | Yes         | Yes                      | Passed              | Unit adapter passed     | Fixture passed  | Pending        | Pending                |
| Investment Contributions    | Yes         | Yes                      | Passed              | Unit adapter passed     | Fixture passed  | Pending        | Pending                |
| Risk & Drawdown             | Yes         | Yes                      | Passed              | Unit adapter passed     | Fixture passed  | Pending        | Pending                |
| Portfolio Comparison        | Yes         | Yes                      | Passed              | Unit adapter passed     | Fixture passed  | Pending        | Pending                |
| Market Data Health          | Yes         | Yes                      | Passed              | Unit adapter passed     | Fixture passed  | Pending        | Pending                |

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
