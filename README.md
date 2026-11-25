> **Personal Finance Dashboard — customized MoneyMatter fork.** Built on the upstream AGPL-3.0-only project, retaining its native finance ledger, accounts, authentication, interface and provider infrastructure. This fork adds personal reporting, income and tax planning, payroll history, consolidated investment analytics and Raspberry Pi operations. The upstream project README follows the fork-specific overview.

## This fork: custom features

The following describes capabilities implemented in the repository, not a guarantee that every provider is connected, every historical record is complete, or the latest commit is deployed.

| Area | Custom additions | Detailed documentation |
| --- | --- | --- |
| Personal net worth | Dated manual/CSV/worksheet balance history, custom asset/liability reporting groups, linked account aggregation, historical corrections, principal and contribution provenance, source-aware charts, manual-only fallback | [Personal finance](docs/PERSONAL-FINANCE.md), [Google Sheets sync](docs/GOOGLE-SHEETS-SYNC.md) |
| Income | Separate Actual and Projected Income, multiple employments, versioned pay statements and salary events, annualized salary, gross/net/total compensation, bonuses, employee and employer retirement contributions, deductions, actual pay charts, management/import controls | [Payroll implementation](docs/PAYROLL-IMPLEMENTATION.md) |
| Taxes and take-home pay | Shared year-specific wage tax calculation, federal/state/local inputs and supported deductions, FICA, retirement limits, matching, income allocation, savings and spendable income, projected breakdowns and income/tax reporting; estimates stay separate from actual payroll | [Tax rules and limitations](docs/INCOME-TAX-RULES.md) |
| ADP and payroll imports | Manual/file imports, revised statement deduplication, annual YTD evidence, owner-operated Windows ADP companion using official sign-in and MFA; not an unattended payroll API | [ADP companion](docs/PAYROLL-ADP-EXPORT.md), [Integration review](docs/PAYROLL-INTEGRATIONS.md) |
| Investments | Consolidated portfolio views, performance, value versus invested capital, benchmark comparisons, realized/unrealized gains, cash and holdings, dividends, allocation, treemap, concentration, fund overlap, company/sector/geography exposure, contribution reconciliation | [Analytics architecture](docs/INVESTMENT-ANALYTICS-ARCHITECTURE.md), [Account gains](docs/INVESTMENT-ACCOUNT-GAINS.md) |
| Investment history and market data | Incremental persisted daily account valuation, dirty-range rebuilds, source-aware historical prices, scheduled quote updates, dated fund constituent disclosures and coverage reporting | [History](docs/INVESTMENT-HISTORY-ARCHITECTURE.md), [Market data](docs/INVESTMENT-MARKET-DATA.md), [Fund composition](docs/INVESTMENT-COMPOSITION-COMPLETION.md) |
| Brokerage records | Broker CSV/statement normalization, immutable position and tax evidence, stable import identities, hidden mirrors independent of net-worth inclusion, read-only Public API sync and crypto quote fallback | [Broker imports](docs/BROKER-PORTFOLIO-IMPORTS.md), [Portfolio providers](docs/PORTFOLIO-PROVIDERS.md) |
| Dashboards and presentation | Twenty optional investment widgets with independent saved settings, shared analytics/chart components, income widgets and responsive chart controls, shared financial color registry and updated spending/savings pace charts | [Investment widgets](docs/INVESTMENT-WIDGETS.md), [Financial colors](docs/FINANCIAL-COLORS.md), [Payroll implementation](docs/PAYROLL-IMPLEMENTATION.md) |
| Bank sync and spending | SimpleFIN overlap, budgeted requests, late-posting recovery, historical transaction reconciliation, MCC enrichment, local deterministic categorization and scheduled spending reports | [SimpleFIN](docs/SIMPLEFIN-SYNC.md), [Historical transactions](docs/HISTORICAL-TRANSACTION-IMPORT.md), [Categorization and reports](docs/LOCAL-CATEGORIZATION-REPORTS.md) |
| MCP | Native scoped tools plus personal net worth and investment reads/writes; stable broker row IDs for individual and bulk trade import, existing-bank-transaction contribution linking, OAuth ownership checks | [MCP deployment and discovery](deploy/README.md#authenticated-mcp) |
| Self-hosting | Raspberry Pi ARM64 Docker stack, prebuilt Windows deployment scripts, health checks, database backups, SSH/VPN access and separately protected HTTPS/PWA access | [Deployment](docs/HOW-TO-DEPLOY.md), [Pi setup](deploy/README.md), [iPhone security](docs/IPHONE-SECURITY.md) |

### Developer quick links

- [How to work on this fork](Howtowork.md) — local setup, code layout and development workflow.
- [How to deploy](docs/HOW-TO-DEPLOY.md) — four scripts, manual frontend/backend builds, verification and rollback.
- [How to view the database](docs/HOW-TO-VIEW-DATABASE.md) — PostgreSQL CLI and Windows DBeaver via SSH.
- [Agent instructions](AGENTS.md) — fork-specific context and guardrails; [CLAUDE.md](CLAUDE.md) contains upstream code conventions.
- [Deployment verification history](docs/DEPLOYMENT-VERIFICATION.md) — dated evidence, not a live health check.
- [Stable upstream integration notes](docs/UPSTREAM-STABLE-UPDATE-2026-11-20.md).

**Normal deployment:** build on Windows, upload compiled artifacts, then deploy only the affected service on the Pi. Never compile the full application on the Pi as a routine update. Do not commit production credentials, statements, financial exports, database dumps or deployment logs.

**Known boundaries:** historical snapshots are not trades or deposits; missing evidence remains unavailable; provider price updates do not prove brokerage quantities are current; payroll tax projections are not tax-return preparation; the ADP companion requires user interaction; ChatGPT MCP discovery may require a fresh scoped authorization and has not yet been verified for the latest investment additions.

---

<div align="center">

<img src="packages/landing/public/img/logo.svg" width="72" alt="MoneyMatter logo">

# MoneyMatter

**Open-source personal finance. Your finances, your server, your rules.**

Accounts, budgets, investments, loans and net worth in one place.<br>
Self-host it for free, or use the cloud.

[Website](https://moneymatter.app) · [Docs](https://docs.moneymatter.app) · [Self-host](self-hosting/README.md) · [Cloud](https://moneymatter.app/sign-up) · [Roadmap](https://moneymatter.featurebase.app/dashboard/roadmap) · [Community](https://www.reddit.com/r/moneymatterapp/) · [Changelog](https://github.com/letehaha/moneymatter/releases)

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![CI](https://img.shields.io/github/actions/workflow/status/letehaha/moneymatter/check-source-code.yml?branch=main&label=CI)](https://github.com/letehaha/moneymatter/actions/workflows/check-source-code.yml)
[![Release](https://img.shields.io/github/v/release/letehaha/moneymatter)](https://github.com/letehaha/moneymatter/releases)
[![Crowdin](https://badges.crowdin.net/moneymatter/localized.svg)](https://crowdin.com/project/moneymatter)

</div>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="packages/docs/public/screenshots/getting-started/app-overview.dark.png">
  <img src="packages/docs/public/screenshots/getting-started/app-overview.png" alt="The MoneyMatter dashboard: balance trend, cash flow, expenses structure, latest transactions and a categories watchlist, with accounts, portfolios, vehicles and loans grouped in the sidebar.">
</picture>

<details>
<summary><b>More screenshots</b></summary>
<br>

<table>
  <tr>
    <td width="50%">
      <img src="packages/landing/public/img/landing/screenshots/net-worth@2x.webp" alt="Net worth history chart stacked by cash, investments, vehicles and ventures">
      <br><sub>Net worth history</sub>
    </td>
    <td width="50%">
      <img src="packages/landing/public/img/landing/screenshots/money-flow@2x.webp" alt="Money flow diagram from income through expenses and savings to categories">
      <br><sub>Money flow</sub>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <img src="packages/landing/public/img/landing/screenshots/investments@2x.webp" alt="Investment portfolio with total value, total return and gains per holding">
      <br><sub>Investments</sub>
    </td>
    <td width="50%">
      <img src="packages/landing/public/img/landing/screenshots/transactions@2x.webp" alt="Transactions list with categories, accounts and payee logos">
      <br><sub>Transactions</sub>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <img src="packages/landing/public/img/landing/screenshots/bank-providers@2x.webp" alt="Bank provider picker listing LunchFlow, SimpleFIN, Monobank and Walutomat">
      <br><sub>Bank connections</sub>
    </td>
    <td width="50%">
      <img src="packages/landing/public/img/landing/screenshots/import-sources@2x.webp" alt="Import options: any text source, CSV, OFX, YNAB, Wallet and Microsoft Money">
      <br><sub>Import sources</sub>
    </td>
  </tr>
</table>

Every feature is explained, with screenshots, in the [help center](https://docs.moneymatter.app).

</details>

MoneyMatter shows you where your money is and where it goes. Add accounts by hand or sync them from your bank, and it turns your transactions into balances, a dashboard and reports in one base currency. It goes beyond cash: investments, loans, vehicles and private deals are part of your net worth too. Any AI agent can work with your data over MCP.

> [!TIP]
> [MoneyMatter Cloud](https://moneymatter.app) is the same app, hosted: a 40-day free trial, no card required. Self-hosting is free and every feature is enabled.

## Contents

1. [Features](#features)
2. [Get started](#get-started)
3. [Connect an AI agent](#connect-an-ai-agent)
4. [Documentation](#documentation)
5. [Tech stack](#tech-stack)
6. [Contributing](#contributing)
7. [License](#license)

## Features

- **Accounts** in any currency, manual or [synced from your bank](https://docs.moneymatter.app/import/bank-connections/) through Monobank, SimpleFIN, LunchFlow and Walutomat
- **Transactions** with categories, payees, tags, splits, attachments, [transfers and refunds](https://docs.moneymatter.app/transfers-and-refunds/how-transfers-work/), and automation rules for new ones
- **Budgets**, subscriptions and bills with reminders, and loans with a payoff projection
- **Investments**: portfolios of stocks, ETFs and crypto with daily prices, plus venture deals and [vehicles](https://docs.moneymatter.app/accounts/vehicles/), all counted in your net worth
- **Reports**: a customizable [dashboard](https://docs.moneymatter.app/stats/dashboard/), cash flow, money flow, net worth history and a [pivot table](https://docs.moneymatter.app/stats/analytics-reports/)
- **Multi-currency** with [automatic exchange rates](https://docs.moneymatter.app/settings/base-currency-and-currencies/) and one base currency for every total
- **Import** from [CSV](https://docs.moneymatter.app/import/import-from-csv/), OFX/QFX, [YNAB, Wallet and Microsoft Money](https://docs.moneymatter.app/import/other-import-sources/), or any statement file parsed with AI. Export to JSON, CSV or XLSX, and [back up and restore](https://docs.moneymatter.app/settings/security-and-account/#backup-and-restore) everything
- **AI**: bring your own model (OpenAI, Anthropic, Google, Ollama or any OpenAI-compatible endpoint) for categorization and statement parsing, and a remote MCP server for Claude, ChatGPT or any agent
- **Sharing**: share an account or tracker with someone, or give a household member access to all your accounts
- **Security**: sign in with [email, Google, GitHub or passkeys](https://docs.moneymatter.app/settings/security-and-account/), credentials encrypted at rest, and your data exportable or deletable at any time
- **Everywhere**: light and dark theme, a layout that works on your phone, and English, Ukrainian, Spanish, Indonesian and Russian

## Get started

**Try it.** The **Try demo** button on [moneymatter.app](https://moneymatter.app) opens a ready-made account with sample data. No sign-up required, and it expires after four hours.

**Self-host.** The stack pulls published Docker images (amd64 and arm64) and exposes the whole app on one port, so you can put it behind whatever reverse proxy you already run, or use the optional Traefik + Let's Encrypt overlay.

```bash
git clone https://github.com/letehaha/moneymatter.git
cd moneymatter/self-hosting
cp .env.example .env   # then fill the REQUIRED section
docker compose up -d
```

Open `http://<host>:8080`. The [self-hosting guide](self-hosting/README.md) covers the full setup, reverse-proxy recipes, every environment variable and troubleshooting.

**Cloud.** [Sign up](https://moneymatter.app/sign-up) for a 40-day free trial with no card. Paid plans start at $30 a year. See [plans and billing](https://docs.moneymatter.app/settings/plans-and-billing/) for details. You can move between cloud and self-hosted in either direction with a backup export and restore.

## Connect an AI agent

MoneyMatter exposes a remote [MCP](https://modelcontextprotocol.io) server. Add the endpoint to Claude, ChatGPT or any MCP client, pick the access level on the consent screen, and ask questions the UI can't answer: "Which of my subscriptions got more expensive this year?" or "Where can I realistically cut $500 a month?"

```
https://mcp.moneymatter.app/mcp
```

A self-hosted instance serves its own endpoint. See `MCP_BASE_URL` in the [environment reference](self-hosting/docs/environment-reference.md). Connected apps are listed and revocable under **Settings → AI**.

## Documentation

- [Help center](https://docs.moneymatter.app): user guides for accounts, transactions, transfers and refunds, stats, imports, bank connections and settings
- [Self-hosting guide](self-hosting/README.md)
- [Local development setup](docs/application-setup.md)
- [Contributing](CONTRIBUTING.md)

## Tech stack

Vue 3, Vite, TypeScript and Tailwind CSS on the frontend. Node.js, Express, Sequelize, PostgreSQL and Redis with BullMQ on the backend. better-auth for sign-in, the Vercel AI SDK for model access, and the official MCP SDK for the agent server. The docs site runs on Astro Starlight. Everything ships as Docker images.

## Contributing

Bug reports, fixes and features are welcome. Open an issue first for anything non-trivial, then follow [CONTRIBUTING.md](CONTRIBUTING.md) for the workflow and the one-time CLA.

Translations live on [Crowdin](https://crowdin.com/project/moneymatter). Corrections and new languages are welcome there.

## License

This project is licensed under the **GNU Affero General Public License v3.0 (AGPL-3.0)**.

- ✅ Free to use, study, modify, and self-host
- ✅ Free to redistribute under the same license
- ✅ Commercial use permitted (sell hosting, support, custom builds, etc.)
- 🔄 Modifications must be released under AGPL-3.0
- 🌐 If you run a modified version as a network service, you must publish your modifications

See [LICENSE](LICENSE) for full details. The project was previously licensed under CC BY-NC-SA 4.0; that license still applies to versions of the codebase prior to the AGPL-3.0 relicensing commit.
