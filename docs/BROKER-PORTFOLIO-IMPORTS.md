# Broker export import and preservation

The native Portfolio area already supports stock/crypto holdings, security price history, buys/sells/dividends, direct cash activity, cash transfers, allocation, gain calculations and performance graphs. Broker exports should reuse those structures instead of creating ordinary spending transactions.

## Source coverage

The broker normalizer in `services/import-export/investment-transactions-parser/broker-export-parser.ts` recognizes Robinhood activity CSV and M1 activity CSV. It preserves dates, decimal quantities, quoted prices, signed reported cash, multiline descriptions and source row provenance.

An M1 activity summary is not a trade execution or holdings report. Rows named Morning/Afternoon Trading contain no executed symbol, quantity or price. Position-activity rows and negative dividend corrections need review. A dividend proves a cash payment; it does not prove the current number or basis of shares. No missing M1 trades, opening/current holdings or cost basis are fabricated.

Robinhood files can include splits, symbol changes, mergers, received stock, tax withholding, cash-in-lieu, fees and reversals. Unsupported corporate/position activity remains in the review plan. Affected symbols and symbols whose sells lack prior acquisitions are blocked from quantity replay. Options are not imported as stock shares. Known source cash on such events may be retained separately in the cash audit ledger without asserting a holding or realized gain.

## Non-additive audit portfolios

The installation import creates separate clearly labeled **partial imported history** portfolios with `isEnabled: false`. Existing connected bank accounts and the existing enabled native portfolio are preserved. Native net-worth queries only include enabled portfolios, preventing imported historical detail from adding a second copy of the same SimpleFIN assets.

The M1 export is one invest-account component. It must not be treated as the current combined balance of all M1 investment/IRA components. Robinhood brokerage history must not be assumed to include crypto. Account associations and limitations are recorded in portfolio descriptions and the private import audit.

Disabled audit portfolios can be inspected and edited in the Portfolio area. They should not be enabled for aggregate net worth until complete holdings/opening cash, corporate actions and current bank valuations are reconciled. Their observed-source cash sums are not asserted to be current balances, and partial holdings cannot establish complete total or annualized returns.

## Exact cash and price meaning

For imported trades, cash and quantity are observed in the export. The script derives net cash per share for the native cost/proceeds calculation and retains the broker's separately reported quoted price in the transaction name. Native settlement fields retain the reported cash amount. It does not invent broker commissions or claim net per-share cash is a separate verified execution quote. Rounding residuals are below the native decimal scale. Dividends without observed trade history remain cash-only audit activity rather than creating fake zero-share holdings.

## Idempotence

Each normalized source row gets a SHA-256 identity from broker, explicit source account key, date, source action, instrument, quantity, quoted price, cash and description. An occurrence ordinal preserves two genuine identical rows in the same export. Equivalent/overlapping exports with the same source account key reuse those identities. Files and source financial data remain in the ignored private directory.

Native investment-transaction and direct-cash endpoints accept an optional 64-character `sourceRowId`. Inside the canonical transaction, an advisory lock serializes retries and the service checks a provenance prefix in the existing `name`/`description` field before affecting holdings or cash. A repeat returns the original record, without applying another balance delta. Manual investment note changes preserve that prefix. Normal manual transactions without `sourceRowId` retain their existing behavior. Deliberately deleting an imported record allows an explicit later reimport.

The installation import script additionally checks server-side provenance before sending each row and saves per-row results. It requires `--apply` for writes; its default mode only reads account mappings and security search results and creates a private preview. Existing account balances, names and exclusion preferences are re-read and checked afterward. Unresolved securities and unsupported records are surfaced in the private review result, never silently dropped or guessed.

## Validation

Synthetic tests cover signed currency, fractional shares, quoted multiline CSV, missing versus zero values, invalid dates, incomplete M1 execution summaries, stable repeat identities, identical legitimate events, separate source accounts, unsupported corporate actions and missing acquisitions. The normal mapped CSV parser also honors explicit skip mappings before validating ticker/date fields, so a skipped cash-deposit row without a ticker does not appear as a malformed stock trade.

## Detailed M1 activity export

The newer 11-column M1 export (Date, Posted Date, Symbol, Description, Transaction Type, Amount, Units, Unit Type, Unit Price, Security Id, Security Id Type) is recognized by the broker normalizer independently of the legacy four-column summary. Preserve the two dates, CUSIP/identifier and raw document provenance. PURCHASED uses positive reported cost and positive shares; SOLD uses negative reported proceeds and negative shares. Normalize these to native cash outflow/inflow and positive execution quantities; do not negate ACH or dividend signs. Preserve reported settlement amounts independently of rounded quantity-times-price. Recognize explicit completed positive ACH deposits, dividends, lending interest and negative fees; returned deposits, awards, corrections and unrecognized transfers remain review items, never automatically new contributions. Detailed execution evidence is not proof of complete holdings or historical cash. Source keys remain stable across exports for an explicitly selected account; duplicate identical rows carry occurrence ordinals. Partial exports that cannot establish multiplicity require review. Normalizing this export does not wire cross-source reconciliation or an automatic write path; see the reconciliation specification.
