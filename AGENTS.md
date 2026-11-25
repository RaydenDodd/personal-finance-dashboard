# AGENTS.md — MoneyMatter personal-finance fork

Read this file first. It supplies fork-specific operating context for Codex, ChatGPT and other coding agents. The original engineering conventions are in [CLAUDE.md](CLAUDE.md), [.claude/docs/backend-conventions.md](.claude/docs/backend-conventions.md) and [.claude/skills/frontend-rules/SKILL.md](.claude/skills/frontend-rules/SKILL.md). Follow those where applicable; if a named subagent is unavailable, use equivalent safe checks and report limitations.

## Workflow and authority

- Repository: RaydenDodd/personal-finance-dashboard. Default working/release branch is dev; use it unless the owner requests another branch or protection requires one. Preserve unrelated work and avoid unnecessary branches/worktrees.
- Do not commit or push automatically. The owner may explicitly ask an agent with GitHub write access to commit/push; that explicit instruction authorizes the requested change only. Never force-push, reset dirty work, rewrite history or push unrelated files.
- Read current code and relevant documentation before making changes. Do not assume repository state equals deployed state. Verify exact commits, test output and live status separately.
- Never deploy, change production data, adjust credentials, modify networking or run migrations on the live Pi without explicit authorization. If only asked for code, stop at code and tests. Clearly report anything untested or inaccessible.
- Preserve upstream AGPL licensing, notices and core behavior. Do not wholesale replace existing features to implement a fork extension.

## Development and deployment map

| Area | Location |
| --- | --- |
| Vue UI, routes, widgets, API adapters | packages/frontend/src |
| Express routes, controllers, services, Sequelize models, migrations | packages/backend/src |
| Shared types, finance income engine and color registry | packages/shared/src |
| MCP registration, scopes, tools | packages/backend/src/services/mcp |
| Pi Compose, prebuilt scripts, local scheduled operations | docker-compose.pi.yml, deploy/ |
| ADP Windows companion | scripts/adp-companion/ |
| Architecture/verification guides | docs/ |

The Windows checkout is under the owner's Documents/GitHub/Projects directory. The Pi SSH alias is cardgames-pi and its checkout is ~/personal-finance-dashboard. Do not hardcode credentials or use the production database in tests. The Pi has limited resources and previously froze during large analytics reads; avoid full source builds, unbounded queries, simultaneous expensive jobs and speculative backfills.

Use [Howtowork.md](Howtowork.md) for local preview and [HOW-TO-DEPLOY](docs/HOW-TO-DEPLOY.md) for the four Windows/Pi scripts. Build on Windows, upload compiled artifacts, restart only changed services. Backend deployment requires a validated backup, matching ARM64 dependencies and health checks. Preserve previous images and persistent volumes. The local frontend preview connects to live data; read-only smoke tests only unless authorized.

## Financial invariants

- Reuse canonical native services, Money and existing transaction/holding calculations. Never implement a parallel ledger or independent FIFO/valuation engine. Follow CLAUDE.md for cents versus API decimals and avoid raw Sequelize queries on Money fields.
- Historical reporting authority cutoff is 2026-11-05. Preserve older imported observations, dates, source evidence, formulas and manual corrections. Do not turn a snapshot into a trade, income or contribution. Combined accounts remain combined unless evidence supports disaggregation.
- Distinguish actual posted payroll, salary rate/annualization, estimated projections, employer retirement and employee deductions. YTD checkpoints are not individual paychecks. Do not infer gross pay from a bank deposit or apply tax rules to unsupported years.
- Broker holdings, cash observations, executed trades, distributions, transfers, price quotes and tax evidence are different record types. No invented acquisition, cost basis, deposits, returns or missing prices. Fund constituent coverage must retain effective date and unknown residuals. Hidden broker mirrors must not double-count net worth.
- Preserve transaction categorizations, pending/posted distinctions, account ownership, historical source IDs, audit trails and idempotence. Link an existing bank funding transaction once; purchases inside a portfolio are not another external contribution.
- For SimpleFIN use the native importer, overlapping date windows, Redis budget, stable provider IDs and per-account completion semantics. A successful fetch is not proof of fresh bank data. Avoid excess manual sync calls.
- Use additive migrations after a migration has landed on dev. Validate migrations on an isolated restored database before production; never delete/replace live volumes or silently rewrite history.

## UI and chart conventions

Reuse MoneyMatter's native components and shared financial analytics rather than creating a parallel style system. Maintain light/dark mode, container-based responsiveness and mobile touch behavior. Widgets should use the existing styled scrollbar and standard open-page arrow, with per-instance options in the existing gear popover. Preserve layout, filters, date ranges and widget settings. Keep chart math in shared services. Use the canonical financial color registry and documented presentation exceptions; retirement employer match belongs under retirement, not a peer category. Follow existing i18n conventions and do not rewrite unrelated translations.

## MCP changes

Read [.claude/skills/add-mcp-tool/SKILL.md](.claude/skills/add-mcp-tool/SKILL.md). Register tools via defineTool and toolsets, reuse backend service validation, derive the user from OAuth and preserve finance:read/write/delete plus optional toolset scopes. Never bypass read-only mode, ownership, feature entitlements or currency locks. Bulk trade imports use stable broker source-row IDs and report partial results. Maintain metadata generation and drift checks; do not enable public unauthenticated tools to solve discovery. Verify actual scoped tools/list and client discovery separately; do not claim the current ChatGPT connector exposes writes just because the code does.

## Test and release expectations

- Write focused regression tests for bugs and endpoint integration tests where appropriate. Use isolated fixtures/test database; HTTP e2e tests follow CLAUDE.md. Do not run concurrent e2e suites.
- Windows Jest discovery previously required `npm run test:unit -w packages/backend -- --testMatch "**/*.unit.ts" --passWithNoTests=false --runInBand`. Add a focused testPathPattern when useful. Zero tests is a failure. Run backend typecheck separately (Vite transpiles without full checking).
- Frontend: `npm run test:unit -w packages/frontend -- --run`, typecheck/build as appropriate. Use oxfmt, not Prettier.
- For deployment scripts, retain live output, exit status checks, private logs, version matching, backups and targeted restart. Do not conceal failed tests or silently skip required gates.
- Keep credentials, private source documents, payroll/broker exports, backup dumps, logs and financial evidence outside Git. Never paste secrets or raw financial records into issues or agent output.

## Read the relevant guide first

| Task | Documentation |
| --- | --- |
| Historical balances/principal/Sheets | [Personal finance](docs/PERSONAL-FINANCE.md), [Sheets sync](docs/GOOGLE-SHEETS-SYNC.md) |
| Payroll/income/taxes/ADP | [Payroll](docs/PAYROLL-IMPLEMENTATION.md), [Tax rules](docs/INCOME-TAX-RULES.md), [ADP](docs/PAYROLL-ADP-EXPORT.md) |
| Holdings, brokerage and returns | [Providers](docs/PORTFOLIO-PROVIDERS.md), [Broker imports](docs/BROKER-PORTFOLIO-IMPORTS.md), [Gains](docs/INVESTMENT-ACCOUNT-GAINS.md) |
| Investment analytics/history/market data | [Analytics](docs/INVESTMENT-ANALYTICS-ARCHITECTURE.md), [History](docs/INVESTMENT-HISTORY-ARCHITECTURE.md), [Market data](docs/INVESTMENT-MARKET-DATA.md), [Composition](docs/INVESTMENT-COMPOSITION-COMPLETION.md) |
| Dashboard and palette | [Widgets](docs/INVESTMENT-WIDGETS.md), [Financial colors](docs/FINANCIAL-COLORS.md) |
| Bank sync and reporting | [SimpleFIN](docs/SIMPLEFIN-SYNC.md), [Historical import](docs/HISTORICAL-TRANSACTION-IMPORT.md), [Categorization/reports](docs/LOCAL-CATEGORIZATION-REPORTS.md) |
| Pi, MCP, database | [Deploy](docs/HOW-TO-DEPLOY.md), [Pi setup](deploy/README.md), [Database](docs/HOW-TO-VIEW-DATABASE.md) |

Update the appropriate documentation when changing architecture, operating steps or user-facing capabilities. Record verified results with dates/commit IDs; keep unverified assumptions clearly marked.
