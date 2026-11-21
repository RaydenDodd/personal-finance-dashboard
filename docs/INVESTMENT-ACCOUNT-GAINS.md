# Reconciled investment account gains

Reuse the existing personal-finance principal ledger (`getFinanceAccounts`, `getCashFlows`, `principalFor`), native cash-flow matching, native portfolio summaries/holding values, brokerage observations and persisted daily account values. The new read adapter reconciles these sources; it does not replace holdings, FIFO, transaction processing or pricing.

Reconciled net principal is distinct from dated cash deposits. Owner-confirmed aggregate corrections remain audited principal adjustments in the existing ledger, never fabricated deposits. Imported transfers and worksheet records are compared and matched once; original financial records remain intact. Purchase/sale cash is trading activity, not external funding. Crypto can expose a separately labelled purchase-cost estimate without assigning it cash deposits.

Available full account valuations are usable without an itemized cash snapshot. Holdings-only values remain estimates. Provider combined accounts (such as M1 Total) remain combined; any difference from component estimates is an explicit consolidation adjustment, never invented cash or an arbitrary allocation to a child account. Hidden or unselected components prevent using the full group balance.

Daily account gain is consecutive comparable account value change minus external net funding. Internal trading cash is not external funding. When only holdings values are supported, reuse native holding daily attribution and clearly label that fallback. Breakdowns show source values/dates, principal, recorded deposits/withdrawals, excluded overlaps and any estimate or unallocated group balance.

## Verified broker funding and performance comparisons

Reuse native `PortfolioTransfers` for external funding, `InvestmentTransactions` for purchases/sales/distributions, the existing broker-record JSON store for source evidence, and the existing account-gain read adapter. A funding coverage declaration lists the exact imported source references and their independently checked net control. It can establish cash-flow completeness without declaring transaction/position history complete. Use that verified native funding before an older worksheet checkpoint; never add both sources together.

Add dated aggregate account observations separately from position snapshots so recording a reported cash balance/account total cannot erase the existing quantity/cost-basis anchor. A date-only observation does not claim an exchange quote timestamp. Optional reported Pie-performance fields remain separate from external principal and whole-account gain. Reconcile recorded purchases minus sales, distributions and internal cash movements to these reported figures; expose unresolved differences instead of manufacturing cash flows, principal adjustments or per-security values.
