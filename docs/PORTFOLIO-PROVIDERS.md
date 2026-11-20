# Broker portfolio records

Broker records use the existing native Portfolios, Holdings, InvestmentTransactions and PortfolioTransfers models. Broker mirror portfolios are excluded from net worth; their source records prevent accidental inclusion alongside existing connected or manual balance accounts.

`BrokerPortfolioData` stores immutable dated holdings/cash observations, original document hashes, tax-lot evidence, annual tax summaries and source/review records. A snapshot is not an acquisition or cash flow. Holding recalculation starts from the latest authoritative position and applies subsequent trades. Missing basis, cash and incomplete realized returns are labeled unavailable. Annual tax summaries are separate evidence, never additional dividends or sales.

Imports use stable broker row identifiers and the existing advisory-lock/idempotence infrastructure. Historical disposals with incomplete acquisition coverage may be recorded in excluded mirror portfolios, without creating fictitious opening purchases. Ordinary manual sales retain the existing available-share check. Preserve a database backup and original records before superseding an incomplete earlier import.

## Vanguard statement records and visibility

Vanguard CSV positions and dated statements use the same non-additive broker records and native investment transactions. Reinvested distributions retain both the income and acquisition; settlement-fund sweep entries are not additional contributions. Custody transfers and share-class conversions remain noncash source evidence, with actual position snapshots anchoring quantities. Never infer that a separate legacy account belongs to an IRA without transfer evidence. Preserve missing basis as unknown.

Hide portfolio removes a portfolio from Investments and its sidebar list. Show hidden restores access, and Show portfolio makes it visible again. This user preference is independent of net-worth inclusion: showing a broker mirror does not double-count the corresponding SimpleFIN balance.

## Crypto market-price fallback

The existing 15-minute crypto price scheduler and manual securities refresh use public Coinbase USD tickers when the optional primary quote provider has no result. Only an allowlisted, verified CoinGecko identity plus matching display symbol can select a product. Requests are fixed-origin GETs with timeouts and no redirects, credentials or trading endpoints. Invalid, future or over-one-hour-old quotes are rejected. Prices retain their actual upstream timestamp and Coinbase source; failures preserve existing prices rather than stamping them current. This refreshes market quotes, not broker quantities or missing acquisitions.

Reference: [Coinbase public product ticker](https://docs.cdp.coinbase.com/api-reference/exchange-api/rest-api/products/get-product-ticker).

## Public provider

The official Public API client has a fixed HTTPS origin, rejects redirects and permits only account, portfolio, history and unrealized-tax-lot GET endpoints. Its only POST exchanges a personal secret for a 15-minute access token. Trading endpoints are absent from the allowlist.

Authenticated owner endpoints:

- `PUT /api/v1/investments/providers/public` accepts `{ "secret": "..." }` over a trusted secure connection. Never commit credentials, pass them on a command line, or include them in logs.
- `GET /api/v1/investments/providers/public` returns connection status, last success, a sanitized error and the six-hour interval. It never returns credentials.
- `POST /api/v1/investments/providers/public/refresh` performs a manual read-only broker sync. The Public portfolio card exposes this action.

Personal secrets are stored with the existing AES-256-GCM credential encryption. Access tokens are memory-only. PostgreSQL backups contain encrypted credentials and require the existing application encryption key for restoration.

The shared cron infrastructure checks for due connections every five minutes. Connections become due six hours after their last successful sync, so missed work is caught after a reboot. A distributed lock prevents overlapping scheduled/manual runs. Failures retain stored records, surface a sanitized status and remain eligible for retry. History pagination must complete; repeated cursors and excessive sessions fail explicitly. Stable upstream event IDs prevent repeated cash/trade imports.

Positions and dated broker values remain authoritative even when API history begins after the account's earliest acquisitions. Corporate actions, missing acquisition basis or incomplete tax years must not be replaced with invented transactions or claimed complete returns.

Official references: [authorization](https://public.com/api/docs/resources/authorization/create-personal-access-token), [accounts](https://public.com/api/docs/resources/list-accounts/get-accounts), [portfolio snapshots](https://public.com/api/docs/resources/account-details/get-account-portfolio-v2), [history](https://public.com/api/docs/resources/account-details/get-history), [unrealized tax lots](https://public.com/api/docs/resources/tax-lot-selling/get-unrealized-tax-lots).
