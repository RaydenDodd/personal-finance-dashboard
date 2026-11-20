# Investment market data and composition sources

Audit date: November 20, 2026. This analytics extension reuses MoneyMatter's
existing price persistence, providers, refresh endpoint and jobs. It does not
install infrastructure, buy a subscription or add a duplicate pricing scheduler.

## Existing implementations

| Capability                        | Existing source                                                                      | Analytics treatment                                                                                            |
| --------------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Stock, ETF and mutual-fund prices | Yahoo provider and composite fallback to configured FMP, Polygon and Alpha Vantage   | Reuse stored `SecurityPricing`, its effective date and provider; unavailable provider keys remain unavailable. |
| Crypto                            | Existing CoinGecko provider plus existing Coinbase quote support                     | Preserve existing routing and precision.                                                                       |
| Historical prices                 | Existing historical-sync service and persisted pricing rows                          | Historical valuations use prices appropriate to the date, never today's quote retroactively.                   |
| Security identity                 | Securities UUID, ISIN/CUSIP, venue, currency, asset class and provider symbol        | A display ticker alone cannot establish equivalence.                                                           |
| Current portfolio evidence        | `getHoldingValues`, brokerage records and actual snapshots                           | Keep source observation dates visible; missing basis and history remain unknown.                               |
| Refresh                           | `POST /investments/sync/securities-prices` with existing admin and rate-limit guards | Refresh shared quotes; no share quantities or brokerage transactions changed.                                  |
| Stock schedule                    | `securitiesDailySyncCron`, `0 6 * * *`, `America/New_York`                           | Existing daily 6 am Eastern schedule, with DST interpreted by the named timezone.                              |
| Crypto schedule                   | `cryptoPricesSyncCron`, default 15 minutes UTC                                       | Existing `CRYPTO_PRICES_SYNC_INTERVAL_MINUTES` controls valid supported intervals.                             |

The factory caches provider instances. Market price persistence and existing
shared job behavior remain authoritative. No new promise of hourly equities or
NAV updates is made. The source audit alone does not prove any particular live
job succeeded; deployed evidence must establish actual refresh/price coverage.

## Fund holdings source decisions

**Vanguard:** the official [VOO product page](https://investor.vanguard.com/investment-products/etfs/profile/voo)
provides portfolio information. Its [terms](https://investor.vanguard.com/terms-conditions)
allow limited personal informational use and restrict repeated automated access
outside Vanguard-provided mechanisms. A downloaded, permitted personal-use file
can be imported with its source date. An unattended website scraper is not
enabled or represented as a licensed API.

**Invesco:** the official [QQQ product page](https://www.invesco.com/us/en/financial-products/etfs/invesco-qqq-trust-series-1.html)
exposes dated holdings and an export action. The [QQQ description](https://www.invesco.com/qqq-etf/en/about.html)
identifies ICB classifications. Retain that taxonomy rather than silently mixing
it with GICS. Its [terms](https://www.invesco.com/us/en/resources/terms-of-use.html)
restrict repeated automated access and data extraction tools. No authenticated
or licensed automated API was verified in this audit, so scheduled issuer
downloading is not enabled by assumption. Intended personal-use exports can
supply dated manual imports.

**SEC N-PORT:** [public data sets](https://www.sec.gov/data-research/sec-markets-data/form-n-port-data-sets)
are derived from public fund filings and distributed as quarterly archives.
These are suitable dated evidence, with issuer/series/security identity mapping
and filing amendments checked. The [readme](https://www.sec.gov/files/nport_readme.pdf)
documents as-filed caveats and tables. Whole quarterly archives are hundreds of
megabytes, so they should not be fetched by each dashboard request. The SEC
[access guidance](https://www.sec.gov/about/webmaster-frequently-asked-questions)
requires an identified User-Agent and currently limits traffic to ten requests
per second. No bulk archive downloader or unattended filing-resolution provider
is claimed as operational until implemented and tested.

**Other sources:** existing configured price providers are not automatically
assumed to license full fund composition, security classifications, distribution
forecasts or total-return benchmark series. No paid provider has been enabled.

## Composition provenance and quality rules

Import CSV/JSON snapshots through the separate composition interface. Require an
effective date, provider/source, stable fund identity and decimal weights. Keep
retrieval time, classification standard and coverage with the immutable snapshot.
Repeated identical imports must be idempotent. Composition records must never
create investment transactions, direct shares, tax lots or financial cash flows.

Partial composition leaves a residual Unknown category; it is never scaled to
100%. Recursive funds must stop cycles and avoid counting a wrapper alongside
its children. Geography defaults to underlying issuer country; exchange listing,
fund domicile and revenue geography are different information. Historical
look-through requires a composition known for the historical date.

Price-only benchmark data must be labeled price-only. Portfolio balances cannot
be compared to index levels. Normalize comparable return series to a common
start, and preserve missing source/history conditions instead of inventing
returns, dividends, classifications or future payments.

## Live coverage

Pending deployment verification. Interfaces and calculation tests do not prove
that external fund composition or benchmark history is present for the owner's
actual holdings. The completion matrix records those separately.
