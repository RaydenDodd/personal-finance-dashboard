# Fund composition integration

Implementation baseline: the supplied MoneyMatter ETF & Mutual-Fund Look-Through research, 20 November 2026.

## Existing services reused

The Investment Engine continues to obtain positions and valuations from `getHoldingValues`, account totals from `getPortfolioSummary`, and recorded transactions, FIFO gains, historical pricing and broker records from the existing investment services. No alternate position, pricing, cost-basis or gain calculation is introduced. Composition is stored in the existing owner-scoped `InvestmentFundSnapshots` JSONB table. The existing `lookThrough`, fund overlap, allocation and shared page/widget query remain the consumption path. Direct Holdings continues to use native securities, including fund wrappers.

## Additions

A source registry, bounded CSV/XLSX/SEC N-PORT parsers, source validation, preserved compressed source files and checksums, import previews, and fund-level source health are added around that path. Parsers convert source units into the existing percentage-weight contract. They never scale an incomplete list to 100%. Source report date and retrieval time are distinct. Unweighted records, signed derivatives, cash and commodities retain their own classifications. Failed imports do not replace the last usable snapshot.

SEC series and class identifiers identify a portfolio independently of its ticker. Windsor II classes share one source composition but remain separate native positions. A conflicting SPCX security name without a matching CUSIP/ISIN is held for review; analytics does not rename or edit the security. Hidden portfolios are excluded in the shared analytics service even when explicitly selected; net-worth exclusion is a separate setting and does not hide an otherwise visible portfolio.

## Refresh boundary

Issuer export availability does not establish permission for unattended scraping. Vanguard and Invesco exports remain manual. An identified SEC client uses the published series-filtered Atom feed and the filing's XML, serializes requests and stops on 403/429. Public issuer downloads can be imported manually. No bot protection, private feed or undocumented issuer API is bypassed. A scheduled integration is reported operational only after a deployed run is recorded; availability of a parser alone is not evidence.

The completion matrix records the exact imported source URL, report date, row count, original weight sum, residual, and refresh evidence. Source datasets and owner financial verification stay in ignored private storage.

The existing application cron runner checks due disclosures at 07:15 America/New_York. A source is checked at most weekly after an owner enables the SEC schedule with an identified contact. Enabling queues an initial background run; application startup resumes due checks. Hidden portfolios and conflicted securities are excluded. A successful worker record, source report date and next due date are shown separately from the latest preferred snapshot, so an older SEC fallback never masquerades as a refreshed daily issuer export. The first natural clock tick is distinguished from a verified initial background run in release evidence.

File uploads accept original issuer CSV/XLSX, individual N-PORT XML (or a bounded ZIP containing one filing), and GLD's SEC company-facts JSON. Bulk quarterly SEC dataset ZIPs are intentionally rejected; use an individual series filing on the Pi. Legacy canonical CSV/JSON and nested-fund snapshots remain supported. Raw files and quarantine records stay in the same owner-scoped composition store and are omitted from ordinary analytics responses.
