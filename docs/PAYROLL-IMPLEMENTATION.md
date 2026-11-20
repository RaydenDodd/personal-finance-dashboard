# Actual and projected income implementation

This checklist records the November 19, 2026 Income request. Payroll source documents and exact reconciliation outputs belong in ignored `private/`, never source control. The complete original request is preserved there as `payroll-requirements.txt`.

## Requirements and phase checkpoints

- [x] Inspect the existing Income ledger, plan engine, allocation doughnut/Sankey, dashboard layout system and native chart interactions.
- [x] Preserve existing projected salary, contribution percentages, employer match, tax assumptions, allocations and manual overrides.
- [x] Add owner-scoped, versioned payroll source, employment, statement and salary-event storage through an additive migration.
- [x] Normalize all supplied detailed JSON statements; preserve source identity, signed amounts, adjustments, source evidence and previous revisions.
- [x] Reconcile paycheck allocations, independent yearly totals and latest YTD checkpoints. Never sum YTD fields as payments.
- [x] Verify representative source PDFs, rate annualization, bonuses/noncash offsets and employee/employer retirement mappings.
- [x] Validate repeated imports, changed statements, missing fields, adjustments and concurrent imports before live import.
- [ ] Import the verified source after a database backup; retain manual payroll and all unrelated financial records.
- [ ] Separate Actual Income and Projected Income routes/sidebar/mobile links. Existing Income links remain valid. Default parent opens Actual.
- [ ] Keep projected allocation doughnut, flow, breakdown and settings; independent period preference and no retroactive effect on actual payroll.
- [ ] Actual summary: current annualized base salary separate from selected actual gross/net/tax/retirement/benefit/bonus totals and total compensation.
- [ ] One payroll management dropdown: sync status/import/paychecks/employments/salary history/settings/history, native dialogs and save-to-close.
- [ ] Upgrade salary history using native chart primitives: step rate, employer/position context, observed versus verified effective dates, event markers, continuous mouse/touch tooltip, independent preset/custom range and interval navigation.
- [ ] Received Income: stacked rectangular bars plus gross line on same axes, paycheck/month/quarter/year aggregation, dollar/percent, employer/date/category controls, incomplete-period labels, signed adjustments and reconciled totals.
- [ ] Employment/position and manual earlier salary management; sustained pay-rate changes, growth statistics, no invented promotion/effective date.
- [ ] Reconcile existing bank deposits and manual paychecks without creating duplicate native transactions; support split deposits and preserve unrelated income.
- [ ] Integrate verified employee/employer retirement contributions with principal evidence without duplicating existing dated contributions/checkpoints.
- [ ] Reuse the same actual calculations in summary/charts/reports/optional main dashboard widgets; preserve original Trends charts and add-ons.
- [ ] Optional dashboard widgets: actual summary, salary history, received income, salary growth, bonuses, retirement, tax, projected summary and projected allocation; add/remove/reorder/resize/configure with independent settings, no automatic additions.
- [ ] User-initiated payroll update reminder (default 30 days, configurable, snooze/dismiss, once per app session); no background ADP sync.
- [x] Investigate official ADP API/browser authentication feasibility and applicable terms before enabling any session integration.
- [ ] Final targeted and regression validation: owner isolation, source immutability, duplicate handling, actual/projection independence, chart/date/mobile interactions, widgets, bank and principal reconciliation, backups, deployed health and Git sync.

## Decisions

1. Existing Income plans remain the projection authority. Detailed payroll is actual evidence, not an overwrite of user planning assumptions or account balances.
2. Actual net payroll explains deposits. Import must not manufacture a second native income transaction or payroll-withholding spending transactions.
3. Salary is based on regular pay rate and verified frequency. First observed pay date is not silently relabeled as a verified effective date. Missing hours/frequency/position dates remain unknown.
4. Employer retirement increases total compensation, not paycheck net; deduction/memo evidence determines actual amounts. Observed percentages are not permanent future elections.
5. Missing historical evidence remains absent. Source discrepancies and unmatched contributions/deposits are explicit review items.
6. MoneyMatter never receives ADP employee credentials, MFA codes, cookies or authenticated browser state. No background polling or automated login is enabled. A separately user-operated temporary local browser may export the user's own JSON after normal interactive sign-in; permitted access and manual import remain explicit.

## ADP access feasibility

The user's working internal MyADP same-origin endpoints were assessed separately from the official developer API. They do not require developer credentials when used within an authenticated employee page. This establishes technical feasibility of personal export; the official employee terms restrict unauthorized third-party gathering and do not establish a supported integration contract for undocumented endpoints.

See [the browser approach and assisted workflow](./PAYROLL-ADP-EXPORT.md). A one-shot local helper uses a nonpersistent browser, interactive user sign-in/MFA, explicit export confirmation, sequential same-origin read requests and unconditional context cleanup; it never gives ADP credentials to MoneyMatter. A fresh live MFA export is not verified during implementation. The supported import path remains user-downloaded JSON/PDF. Successful imports are recorded separately from provider syncs; opening a link or canceling never reports successful synchronization.

No paid services, public infrastructure, SimpleFIN schedule changes or unrelated Investments features are part of this implementation.

## Reuse map

- `income-management/overview.vue`, `taxes.vue`, `income-allocation.vue`: existing projected income UI and settings.
- `services/income-management/{index,ledger,pace}.ts`: existing planning/bank income interfaces.
- `widgets/balance-trend.vue`, native chart composables/tooltips: interaction and styling reference.
- Analytics monthly comparison: stacked bar reference.
- `pages/dashboard` and widget registry: native layout and optional widget infrastructure.

## Source mappings and validation evidence

Exact source mappings, hashes, totals, statement anomalies and PDF comparisons are documented in ignored `private/payroll-source-audit*` outputs. Synthetic tests may use invented data only; real payroll payloads must not enter fixtures, source files, logs or commits.
