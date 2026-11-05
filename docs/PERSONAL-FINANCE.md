# Personal finance dashboard customization

This is an AGPL-3.0-only fork of [MoneyMatter](https://github.com/letehaha/moneymatter), preserving its Vue interface, original dashboard, theme, navigation, PostgreSQL storage, authentication, SimpleFIN integration, transactions, and MCP server. Upstream notices, license, and history are retained. Customizations are provided under the same license; the corresponding source is this repository.

## Existing features retained

The upstream application already provides manual accounts and transactions, account groups, native transfer matching/overrides, credit-card transfer handling, net-worth history, portfolio contributions/transfers, annualized portfolio returns using dated flows, CSV/OFX imports, provider synchronization, session authentication, encrypted credentials, and MCP OAuth scopes. These remain available. The additional Personal finance report handles custom reporting categories and independently recorded balance snapshots; historical valuations never become spending transactions or inferred investment contributions.

The four initial reporting categories are Spendable Money, Savings, Investments, and Retirement. Account category selection is independent of its banking account type. Each reporting account can be included or excluded and marked as an asset or liability. Link a bank account to its canonical reporting account rather than creating another reporting account when a second provider connects. A regular Vanguard brokerage account is never enabled automatically.

## Historical Google Sheets import

The initial source workbook is read-only. No script in this repository writes to Google Sheets, and no OAuth token is required by the application to retain imported history. To refresh it later, retrieve bounded CellData for the **Networth Calculator** tab through your authorized Google Drive/Sheets integration, including `formattedValue,userEnteredValue,effectiveValue`, and save the result outside Git (for example `private/networth-sheet.cells.json`). Only save the spreadsheet response object, not an API token or tool wrapper.

```powershell
node scripts/normalize-networth-sheet.mjs private/networth-sheet.cells.json private/networth-history.json
node --test scripts/networth-sheet.test.mjs
```

The normalizer is intentionally specific to the existing workbook layout: recorded dates in row 3 and financial account balances in rows 4–19. It excludes the Work checkbox, totals, category summaries, growth calculations, notes, and the separate invested-principal section. Formula results are imported as recorded balances; the formula is retained as provenance and never executed. Contributions must be entered or separately imported with reliable cash-flow dates.

Upload the normalized JSON in the Personal finance import panel, map each historical account to the appropriate reporting account, review the preview, then import. Blank cells remain missing, while explicit numeric zero remains a real balance. Snapshot dates use the actual Sheets date serial, including its year, even when a year heading disagrees. Stable source-cell identifiers make repeated imports idempotent. Corrected values retain previous revisions.

Some historical rows combine multiple accounts or change institutions over time. Preserve those rows as historical aggregates until dated evidence supports a split. Do not simultaneously include a combined historical row and its underlying accounts for the same valuation period. Renaming a historical row alone cannot reconstruct the original component balances.

The initial read identified 16 account rows, 618 balance observations and 42 recorded dates from 2022-06-15 through 2026-09-01. No real balances or transactions are in this repository. One year-heading discrepancy is flagged in the private import preview.

## Accounting conventions

Net worth is the sum of included asset balances minus included liability balances in one reporting currency. Cross-currency totals require a supported dated conversion; never interpret a raw EUR value as USD. Missing balances are displayed as missing, not zero. Each valuation retains its actual date. Prior observations may be displayed with their dates, but must not be presented as newly verified balances on a later snapshot date.

Principal is tracked from explicit external contributions, withdrawals, principal adjustments and paired account transfers. Purchases/sales inside an account, dividends, reinvested dividends and interest are returns rather than new external principal. Simple contribution-based gain is current value minus net principal; its percentage is not an annualized return. Annualized calculations require reliable dated flows and a known opening valuation. Historical balances alone cannot establish investment performance.

Use MoneyMatter's existing Transactions and transfer matching tools for spending. Link both sides of an internal transfer or credit-card payment; spending reports count the underlying purchase. The Personal finance snapshot importer creates no transactions, so importing balances cannot create fictitious expenses.

## Banking connectors

Manual mode is fully independent of paid connectors. SimpleFIN remains upstream's implementation; connecting it requires the user's own subscription/setup token. No paid service is activated by setup. Plaid is deferred until the core report and history are working: use a separate provider adapter implementing the existing bank-provider contract, encrypted connection credentials, Link/Update Mode, provider transaction IDs, reconnect/error state and scheduled sync. Match provider accounts to a canonical account before selecting a preferred source. Do not infer arbitrary past balance snapshots from transaction access. Plaid credentials, real Trial activation, and live bank connections are not part of initial setup.

## Development and deployment

Use the Node version pinned in `.nvmrc` when possible. Run `npm ci` at the repository root. See [the Pi deployment guide](../deploy/README.md) for the private ARM64 Compose project, local backups, restore and authenticated MCP configuration. The original [self-hosting guide](../self-hosting/README.md) remains available. Docker data and secrets must stay outside Git and Docker build contexts.

For the standalone spreadsheet parser, run `node --test scripts/networth-sheet.test.mjs`. For the application, use upstream backend Jest unit/integration tests, frontend Vitest, TypeScript checks and a production build. Synthetic data must be used for screenshots and test fixtures. Integration tests need their own disposable PostgreSQL/Redis services; do not point them at production databases.
