# Investment gain reconciliation

## Reused calculations

`getHoldingValues` remains the source of quantities, open-position basis and valuation. `getPortfolioSummary` supplies account cash and summary values. The existing gains calculator retains FIFO and realized-gain processing. Analytics reads native transfer getters through `nativeExternalFlow`; daily position attribution reuses `dailyPositionChange`. Financial transactions, broker snapshots and imported lots are not rewritten to make totals match.

The new account breakdown aggregates these outputs. Each account exposes priced value, the value and basis included in unrealized gains, recorded net deposits, and the holdings-minus-recorded-deposits comparison. Security rows show quantities, prices, value, basis, average costs and quote times. Holding/basis observation dates are separate from quote timestamps.

## Distinct measures

- **Unrealized holding gain:** current value minus remaining basis, restricted to positions with both values known. Reinvested distributions increase basis.
- **Total account gain:** account value, including cash, minus lifetime deposits plus withdrawals. It requires reconciled funding and account-value evidence. Incomplete trade history is not proof that lifetime funding is complete.
- **Holdings minus recorded deposits:** an inspectable comparison, not a verified lifetime account return. Missing cash and funding remain explicit.

The Overview presents account gain separately from holding gain. Clicking values opens the account/holding breakdown. Repeated per-card “Partial” disclosures were removed. A null account gain is not replaced with a stock-price return or an unsupported extrapolation from incomplete deposits.

## Closing-price repair

Yahoo's 16:00 five-minute bar starts the extended session and is excluded from regular-session candles. Actual `regularMarketPrice` quotes retain their published timestamps, including closing-auction prints seconds after 16:00 and later mutual-fund NAV publication. Their previous-close reference identifies the native quote path.

Current quote refreshes replace original-share values even when the quote belongs to the previous trading day. When a previously stored after-hours row is newer, the native regular-session fallback includes verified closing prints after exactly 16:00, bounded by the requested observation. Historical imports cannot overwrite a verified quote at the same timestamp.

## Deployed verification — November 21, 2026

- Native refresh completed for 74 stock/fund quotes and 5 crypto quotes with no failures. The actual server event automatically refetched the Investments page without reload. A scheduled market-hours tick was not observed on Saturday.
- Subsequent native history refresh returned prices for 89 securities, with no failed securities. Readback verified all 78 visible held securities have numeric, nonfuture graph observations.
- Actual source readback verified direct VOO allocation, hidden-portfolio exclusion, and lazy overlap-detail reconciliation.
- All 20 widget types (22 instances, including three allocation modes) rendered with actual data at 1440, 390 and 320 pixels without page overflow. Production dashboard settings were preserved.
- Gain breakdown interactions passed at 390 and 320 pixels with native scrolling and no dialog overflow; account unrealized contributions summed to the headline.
- 109 backend tests and 27 frontend tests passed, including a regression for an extended-hours row masking a later-published official closing print. Both type checks and production builds passed.
- Investment transactions, holdings, portfolios, transfers, balances and general transactions retained their preservation fingerprints. An independently scheduled Google Sheets contribution and audit entry at 09:00 UTC were retained.

The broker-reported reference total is not yet fully reconciled. Missing cash, incomplete lifetime funding, unresolved Robinhood basis/identity records, and differences between broker observation times and stored holding snapshots remain visible. The application does not claim that the remaining-position subtotal is the broker-style lifetime total.

Fund-source completion and remaining issuer-access limitations are documented in [the composition matrix](INVESTMENT-COMPOSITION-COMPLETION.md).
