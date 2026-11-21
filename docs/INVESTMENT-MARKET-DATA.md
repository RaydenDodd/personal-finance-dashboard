# Investment market data and composition

Current deployed code: `bf1af9a16`, November 20, 2026 (Eastern).

MoneyMatter retains its native Securities, SecurityPricings, composite providers, holding values, portfolio summary, brokerage records and FIFO calculations. No new financial ledger or price cache was introduced.

The existing job registry now runs stocks and supported crypto approximately every five minutes during regular US equity sessions, 09:30–16:00 America/New_York. Exchange holidays, daylight saving and scheduled early closes are guarded. A closing check runs twenty minutes after the scheduled close; existing 06:00 stock maintenance remains. NAV instruments update when their provider publishes a new NAV. Provider observation times are stored without replacing them with retrieval time. Unsupported or failed quotes retain the last valid observation.

The owner-scoped Refresh endpoint is `/investments/analytics/prices/refresh`. It uses the existing provider jobs, locks and rate limiter, excludes hidden portfolios, and rejects foreign/hidden security IDs. The administrator refresh endpoint remains protected. Price writes notify the existing SSE channel; one application listener invalidates shared analytics, holding and security-history queries. Browser fallback polling is restricted to regular market hours.

NYSE session rules were checked against https://www.nyse.com/trade/hours-calendars . Unscheduled exchange closures cannot be predicted. Prices are labeled delayed during trading unless a provider contract establishes otherwise. Daily gains compare the previous recorded regular-session close, prefer official prior-close data returned with Yahoo quotes, and remove native net trade cash including fees. Same-day full exits contribute to the consolidated daily gain. Partial imported trade history remains explicitly labeled.

Actual production evidence after the history backfill: 79 holdings priced, daily changes supported for 79/79 active positions, 1,574 recorded account-value dates, 104 common-date current-holdings price-risk observations, and 1,256 observations each for SPY, QQQ, VTI and VT. These counts establish stored data and deployed readback, not a naturally triggered market-open refresh. The backfill submitted dated observations through the native historical service; identical observations use its existing uniqueness constraint.

A scheduled five-minute market-open tick has not been observed during this evening verification. No claim of continuously live quotes or live composition is made. Source compositions are delayed disclosures; see [the per-fund matrix](INVESTMENT-COMPOSITION-COMPLETION.md).

The new intraday data exposed repeated Intl date-formatter construction in analytics. The deployed helper reuses its Eastern formatter. Following deployment, actual analytics returned successfully and SSH/service checks remained responsive, with no swap use observed. This supports the fix but does not by itself prove the cause of the earlier host freezes.
