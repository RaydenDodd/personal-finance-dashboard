# Personal finance dashboard customization

This is an AGPL-3.0-only fork of [MoneyMatter](https://github.com/letehaha/moneymatter), preserving its Vue interface, original dashboard, theme, navigation, PostgreSQL storage, authentication, SimpleFIN integration, transactions, and MCP server. Upstream notices, license, and history are retained. Customizations are provided under the same license; the corresponding source is this repository.

## Existing features retained

The upstream application already provides manual accounts and transactions, account groups, native transfer matching/overrides, credit-card transfer handling, net-worth history, portfolio contributions/transfers, annualized portfolio returns using dated flows, CSV/OFX imports, provider synchronization, session authentication, encrypted credentials, and MCP OAuth scopes. These remain available. The additional Personal finance report handles custom reporting categories and independently recorded balance snapshots; historical valuations never become spending transactions or inferred investment contributions.

A reporting account can link to several existing MoneyMatter accounts when a worksheet row records their combined balance. Select its linked accounts under Edit; the linked names also open their original MoneyMatter account pages. A bank account can belong to only one reporting row. SimpleFIN captures a combined valuation only when every linked component has a value on the same actual valuation day. Missing components or mixed days leave the group unavailable instead of creating a partial sum.

Personal net worth defaults to **Automatic + personal records**, with **Personal records only** available as a complete manual backup. Through date and the chart period controls select historical valuations. Record balance is available for every account, including accounts with a disconnected bank connection. Correct selected balance opens the actual account/date in the existing dated-valuation form; saving appends a revision, reloads the personal charts and invalidates the related native history/dashboard queries. The CSV template contains the existing reporting accounts and stable account IDs for adding another month. Accounts are considered active from their first recorded observation, so an account that had not opened yet does not make an earlier snapshot incomplete.

The fixed source-authority cutoff is **2026-11-05**, independent of when a bank connection was created. Before that date, provider snapshots are excluded and the dashboard uses the recorded Sheet/import history and explicit dated manual corrections. From that date, verified SimpleFIN values are primary for accounts configured for automatic management. A verified manual correction remains higher priority on the same account/date; choosing manual management also keeps manual/Sheet fallback ahead of provider values. Equal-quality revisions select the latest revision, preserving predecessors. A cutoff never deletes or disables manual records. Effective provider valuation dates are retained; a synchronization timestamp does not create a new valuation date.

An authenticated bank-history CSV import configures historical groups for the original bank dashboard and account pages. Missing historical dates remain absent rather than projecting today's balances backward. Account pages expose a Balance history tab, source labels, month selection and correction links. Combined historical rows are labeled as group totals and never split into invented per-account balances. Several historical rows can map into an existing combined brokerage account while retaining the original personal-page breakdown. The native combined view also sums known principal and shows contribution-based gain only when every active source account has a complete principal basis for that date.

Spending and transaction-selection totals exclude transfer classifications, including one-sided movements to owned investment accounts. The latest-records widget's Between accounts exclusion includes portfolio, venture and loan transfers, while its Out of wallet switch remains independent. Its records follow the dashboard's selected period. The automation editor supports Mark as transfer for explicitly recognized descriptions; classification never creates another transaction and skips pending, linked, refunded, planned and multi-account payments. Bank auto-linking can use an unambiguous masked own-account reference in addition to the existing amount/currency/date and reciprocal-uniqueness checks.

Historical CSV files can include `sourceId`, `sourceKey`, `formula` and `verified` to retain the original Sheet provenance and duplicate detection, along with `accountName`, `accountId`, `date`, `balance` and `currencyCode`. Use Personal net worth → Import history for balance snapshots. The upstream transaction CSV importer expects individual income/spending records.

The four initial reporting categories are Spendable Money, Savings, Investments, and Retirement. Account category selection is independent of its banking account type. Each reporting account can be included or excluded and marked as an asset or liability. Link a bank account to its canonical reporting account rather than creating another reporting account when a second provider connects. A regular Vanguard brokerage account is never enabled automatically.

## Historical Google Sheets import

Imported history remains usable without Google credentials. Optional two-way Google Sheets synchronization now has persistent source tracking, conflict review, native cell-note writes and a five-minute scheduled poll. **Live unattended synchronization is pending durable Google authorization on the Pi; both directions and loop/conflict protection have been tested with synthetic transport fixtures.** The connected Codex Sheets integration does not supply the running server with an offline credential. See [Google Sheets synchronization](GOOGLE-SHEETS-SYNC.md) for the actual setup, source rules and current limitations.

The existing offline import workflow remains available. Retrieve bounded CellData for the **Networth Calculator** tab through an authorized Google Drive/Sheets integration, including `formattedValue,userEnteredValue,effectiveValue`, and save the result outside Git (for example `private/networth-sheet.cells.json`). Only save the spreadsheet response object, not an API token or tool wrapper.

```powershell
node scripts/normalize-networth-sheet.mjs private/networth-sheet.cells.json private/networth-history.json
node --test scripts/networth-sheet.test.mjs
```

The normalizer is intentionally specific to the existing workbook layout: recorded dates in row 3 and financial account balances in rows 4–19. It excludes the Work checkbox, totals, category summaries, growth calculations, notes, and the separate invested-principal section. Formula results are imported as recorded balances; the formula is retained as provenance and never executed. Contributions must be entered or separately imported with reliable cash-flow dates.

Imported USD balances are rounded to two decimal places and use integer cents for financial arithmetic. An offline balance import does not modify the source workbook. Authorized reconciliation or configured two-way synchronization can write verified contributions and dated balances into the existing Sheet while protecting formulas and retaining prior evidence.

Upload the normalized JSON in the Personal finance import panel, map each historical account to the appropriate reporting account, review the preview, then import. Blank cells remain missing, while explicit numeric zero remains a real balance. Snapshot dates use the actual Sheets date serial, including its year, even when a year heading disagrees. Stable source-cell identifiers make repeated imports idempotent. Corrected values retain previous revisions.

For the existing normalized export, an operator can also use the private CLI over an SSH tunnel. Keep `{ "email": "...", "password": "..." }` in ignored `private/owner-credentials.json`. The preparation command creates empty reporting account metadata and saves an exact private server preview; it imports no balances. Review that file before applying:

```powershell
node scripts/import-networth-history.mjs --prepare
node scripts/import-networth-history.mjs --apply
```

The CLI never prints financial values, passwords, session cookies, or response bodies. Repeating it uses existing name/currency mappings and previews duplicates. For renamed or ambiguous account mappings, use the application's mapping interface instead.

Some historical rows combine multiple accounts or change institutions over time. Preserve those rows as historical aggregates until dated evidence supports a split. Do not simultaneously include a combined historical row and its underlying accounts for the same valuation period. Renaming a historical row alone cannot reconstruct the original component balances.

The refreshed balance history contains 16 account rows, 650 observations and 44 recorded dates from 2022-06-15 through 2026-11-01, including October and November 2026. These records power the personal report and mapped native account histories; they are not a static preview. Private transaction exports, contribution evidence, credentials and financial values remain outside Git.

The category cards and total card open balance/history details, and account names or History buttons open an account's individual timeline. The chart shows every recorded observation. Earlier incomplete months use their recorded subtotal with open points and dashed line segments; missing accounts remain missing rather than zero. A vertical guide snaps to the nearest actual observation as the pointer moves, and clicking an observation opens its dated account breakdown.

## Accounting conventions

Net worth is the sum of included asset balances minus included liability balances in one reporting currency. Cross-currency totals require a supported dated conversion; never interpret a raw EUR value as USD. Missing balances are displayed as missing, not zero. Each valuation retains its actual date. Prior observations may be displayed with their dates, but must not be presented as newly verified balances on a later snapshot date.

Principal is tracked from explicit verified contributions, withdrawals, principal adjustments and paired account transfers. Purchases/sales inside an account, dividends, reinvested dividends and interest are returns rather than new external principal. Stable source-cell identities and transaction references make repeated imports idempotent. Corrections append a replacement ledger entry and retain the original audit evidence. Employee and employer contributions are separated only where explicitly supported; an unspecified amount is not allocated by guess.

Simple contribution-based gain is value minus adjusted principal; gain percentage is gain divided by positive principal. Zero principal leaves the percentage unavailable. These are not official brokerage or annualized returns. A known principal checkpoint establishes only its recorded as-of basis, not an invented historical contribution date. A verified-through bound keeps later principal/gain unavailable when intervening contributions have not been verified; the known checkpoint remains visible. Actual dated evidence can be retained even when it does not establish a complete earlier opening basis. Annualized calculations additionally require reliable dated flows and a known opening valuation.

The contribution ledger displays effective dates, provenance, verification and employee/employer kind where available. Its correction form preserves the original entry. Contribution review retains missing payroll evidence without inserting a guessed amount. A confirmed exact bank-description/destination mapping can be reused for future principal transfers from the automation cutoff. Transfers move principal between owned savings/investment accounts without creating income or increasing aggregate principal; a transfer from ordinary spendable cash contributes principal to the destination. Original native transactions remain available for reconciliation.

Use MoneyMatter's existing Transactions and transfer matching tools for spending. Link both sides of an internal transfer or credit-card payment; spending reports count the underlying purchase. The Personal finance snapshot importer creates no transactions, so importing balances cannot create fictitious expenses.

## Banking connectors

Manual mode is independent of paid connectors and remains available indefinitely. SimpleFIN retains upstream's connection and synchronization implementation; connecting it requires the owner's subscription/setup token. The existing authorized connection can supply supported mapped balances, but setup never purchases or activates a subscription. Unsupported accounts remain manual. Plaid remains deferred. Match provider accounts to a canonical account before selecting a preferred source, and do not infer arbitrary past balance snapshots or individual components of a combined brokerage value from transaction access.

## Development and deployment

Use the Node version pinned in `.nvmrc` when possible. Run `npm ci` at the repository root. See [the Pi deployment guide](../deploy/README.md) for the private ARM64 Compose project, local backups, restore and authenticated MCP configuration. The original [self-hosting guide](../self-hosting/README.md) remains available. Docker data and secrets must stay outside Git and Docker build contexts.

On Windows, upstream's installation hooks need Git Bash. Before `npm.cmd ci`, set `$env:npm_config_script_shell = 'C:\Program Files\Git\bin\bash.exe'`. Once the Pi stack is running, `powershell -ExecutionPolicy Bypass -File deploy/start-local-dev.ps1` starts the frontend on `http://localhost:8110` and forwards the existing Pi API through SSH. Stop the dev command to close the tunnel it created. The Pi's `ALLOWED_ORIGINS` must include `http://localhost:8110`. Backend changes can use upstream's Docker development environment or rebuild just the isolated Pi backend after tests.

For the standalone spreadsheet parser, run `node --test scripts/networth-sheet.test.mjs`. For the application, use upstream backend Jest unit/integration tests, frontend Vitest, TypeScript checks and a production build. Synthetic data must be used for screenshots and test fixtures. Integration tests need their own disposable PostgreSQL/Redis services; do not point them at production databases.

Complete backup/recovery of the extension uses the deployment's PostgreSQL dumps. Upstream's in-app export registry does not yet include the additional reporting tables, so an in-app export alone is insufficient for complete recovery. Monthly checks preserve an exact day-one completeness record and mark unavailable day-one valuations as missing; they never relabel a prior market-day valuation as a new day-one observation.

The upstream layouts, global CSS, font and component library are retained. Existing dashboard widgets receive the required historical data and period/transfer filters without a new visual design. Personal net worth is an additional page inside the existing MoneyMatter shell, using its Card/Button/PageWrapper, chart colors and tooltip components. Native account pages add a Balance history tab using the same styling. Synthetic full-shell screenshots are used to compare the shared appearance with the upstream README examples; real balances are never captured for visual QA.
