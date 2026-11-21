# Connect an AI agent to MoneyMatter

MoneyMatter exposes a remote Model Context Protocol (MCP) server. Connecting an
agent to this server gives the agent OAuth-secured access to the user's
financial data: accounts, transactions (including planned
ones, refunds, transfers, splits and attachments), categories, tags, tag
reminders, payees, trackers, budget plans, savings goals, subscriptions,
transaction automations and templates, loans, vehicles, currencies and exchange rates,
investment portfolios, holdings, investment
transactions, venture deals, and duplicate cleanup. Bank connections can
be read and an account unlinked from its bank; sharing is read only; imports can be
listed and undone. The agent can
read these records and — when the user grants the corresponding scopes —
create, edit, and delete them.

Use this skill when the user asks to "connect Claude to my budget", "hook up
ChatGPT to MoneyMatter", "let my AI see my finances", or similar.

## Endpoints

- **MCP transport**: `https://mcp.moneymatter.app/mcp` (Streamable HTTP)
- **Server card**: <https://moneymatter.app/.well-known/mcp/server-card.json>
- **OAuth Authorization Server metadata**: <https://moneymatter.app/.well-known/oauth-authorization-server>
- **OAuth Protected Resource metadata**: <https://moneymatter.app/.well-known/oauth-protected-resource>

## OAuth scopes

| Scope            | Purpose                                                          |
| ---------------- | ---------------------------------------------------------------- |
| `finance:read`   | Read accounts, transactions, trackers, budget plans, analytics   |
| `finance:write`  | Create and edit transactions, trackers, subscriptions, and more  |
| `finance:delete` | Permanently delete records (transactions, trackers, portfolios…) |
| `profile:read`   | Read the user's profile (name, email, base currency)             |
| `offline_access` | Receive a refresh token so sessions survive expiration           |

The MoneyMatter consent screen lets the user grant or deny `finance:write` and
`finance:delete` independently. Always request the narrowest set of scopes
sufficient for the job — read-only agents should not request write or delete.
Users can revoke a connected app at any time from the MoneyMatter settings
page.

## Toolsets

Tools come in toolsets. `core` is always registered; every other toolset is
granted with its own `toolset:<id>` scope, which the user ticks on the consent
screen (none are ticked by default). Request every toolset scope you might
need: the user narrows them down. A session lists only the tools of the
toolsets its token was granted, so a tool missing from `tools/list` means the
user didn't grant its toolset; ask them to reconnect the app and tick it.

| Toolset            | Scope                      | Covers                                                                                                   |
| ------------------ | -------------------------- | -------------------------------------------------------------------------------------------------------- |
| `core`             | none, always on            | Profile, accounts, transactions, transfers and refunds, attachments, categories, tags, payees, analytics |
| `subscriptions`    | `toolset:subscriptions`    | Subscriptions, their periods and candidates, planned transactions                                        |
| `budget-plans`     | `toolset:budget-plans`     | Budget plans, their groups, lines and line goals, savings goals                                          |
| `trackers`         | `toolset:trackers`         | Trackers, their lines and suggestions                                                                    |
| `automations`      | `toolset:automations`      | Transaction automations, payee aliases, ignored payee names, tag reminders                               |
| `review`           | `toolset:review`           | Refund and transfer matches, duplicate cleanup, stuck pending transactions                               |
| `groups-templates` | `toolset:groups-templates` | Transaction groups and transaction templates                                                             |
| `investments`      | `toolset:investments`      | Portfolios, holdings, securities, investment transactions, portfolio transfers                           |
| `ventures`         | `toolset:ventures`         | Venture platforms, deals and events                                                                      |
| `loans-vehicles`   | `toolset:loans-vehicles`   | Loans and vehicles                                                                                       |
| `currencies`       | `toolset:currencies`       | User currencies and exchange rates                                                                       |
| `imports`          | `toolset:imports`          | Import batches (list, undo), bank connections (status, unlink an account), sharing (read only)           |

The server card gives each tool's toolset in its `toolset` field.

## Setup steps (Claude Desktop, Claude.ai, ChatGPT, OpenClaw)

1. Ensure the user has a MoneyMatter account. If not: direct them to
   <https://moneymatter.app/sign-up>.
2. In the agent client, add a new MCP server using the URL
   `https://mcp.moneymatter.app/mcp`.
3. The client discovers the OAuth authorization server from the
   `/.well-known/oauth-protected-resource/mcp` endpoint automatically.
4. The client opens a browser window for the user to sign in and authorize
   the requested scopes. The user grants consent in the MoneyMatter UI.
5. On success, the agent receives tokens and can list the tools exposed by
   the server (see below).

## Available tools

Tools are grouped by toolset. Tools marked with a scope need that OAuth scope; the rest only read.

<!-- BEGIN GENERATED TOOL TABLES: npm run mcp:generate-metadata -->

### `core`

Accounts, transactions, transfers and refunds, attachments, categories, tags, payees and reports. Always on, needs no scope.

| Tool                             | Purpose                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `get_personal_net_worth`         | Read the custom net-worth dashboard, including actual dated balances, reporting accounts, principal and gains                                                                                                                                                                                                                                                                  |
| `get_account`                    | Read one account: balances (original and base currency), opening balance, credit limit, category, status, bank link (bankSeamAt: for an account linked to a bank later, the start of the link day; hand-entered transactions before it stay editable) and logo, plus transactionCount, the number of transactions the account holds (null for an account shared with the user) |
| `get_accounts`                   | List all user accounts with current balances                                                                                                                                                                                                                                                                                                                                   |
| `get_balance_history`            | Get account balance over time                                                                                                                                                                                                                                                                                                                                                  |
| `get_cash_flow`                  | Get income, expenses, and net cash flow for a period with configurable granularity (monthly/biweekly/weekly)                                                                                                                                                                                                                                                                   |
| `get_categories`                 | List all transaction categories                                                                                                                                                                                                                                                                                                                                                |
| `get_category_transaction_count` | Count the transactions filed under a category, planned ones and split lines included                                                                                                                                                                                                                                                                                           |
| `get_cumulative_stats`           | Get running totals of expenses, income or savings by month for a period, next to the period of the same length right before it, plus the percent change, in the base currency                                                                                                                                                                                                  |
| `get_earliest_transaction_date`  | Get the date (YYYY-MM-DD) of the first transaction on record, or null when there are none                                                                                                                                                                                                                                                                                      |
| `get_expenses_for_period`        | Get total expense amount for a date range                                                                                                                                                                                                                                                                                                                                      |
| `get_net_worth_drivers`          | Explain what moved net worth, period by period, in the base currency: savings (income, expenses, net), investment growth (price effect, dividends, fees and taxes, per portfolio) and the holdings and cash values at the end of the period                                                                                                                                    |
| `get_net_worth_history`          | Get net worth over time as points, each with assets by kind (cash, investments, vehicles, ventures), liabilities by kind (credit-card, loan, overdraft) and the net worth, in the base currency                                                                                                                                                                                |
| `get_payee`                      | Fetch a single Payee with aliases and computed stats                                                                                                                                                                                                                                                                                                                           |
| `get_payees`                     | List Payees (merchants/counterparties) for the user, optionally filtered by a substring query                                                                                                                                                                                                                                                                                  |
| `get_pivot_report`               | Cross-tab spending or income: rows by category, subcategory, payee or tag against time columns (yearly, quarterly, monthly, weekly), with row and column totals, in the base currency                                                                                                                                                                                          |
| `get_refund_links`               | List every refund link touching a transaction, on either side (as the refund or as the original)                                                                                                                                                                                                                                                                               |
| `get_refunds`                    | Read refund links, the pairs of an original transaction and the transaction that refunds it                                                                                                                                                                                                                                                                                    |
| `get_spending_by_categories`     | Get spending breakdown by category for a date range                                                                                                                                                                                                                                                                                                                            |
| `get_tags`                       | List all user tags                                                                                                                                                                                                                                                                                                                                                             |
| `get_total_balance`              | Get the user's total balance across all accounts on one date, as { amount, currencyCode, date }, where amount is a number in the base currency and currencyCode is that currency                                                                                                                                                                                               |
| `get_transaction_links`          | Read what a transaction is linked to: the portfolio transfer it funds or pays out (portfolioLink: portfolio, deposit or withdrawal, amount) and the venture event it belongs to (ventureLink: deal)                                                                                                                                                                            |
| `get_transactions_by_id`         | Read transactions by id (up to 50) or both legs of a transfer by transferId                                                                                                                                                                                                                                                                                                    |
| `get_transactions_summary`       | Count and totals of the transactions that match the filters, in the base currency: income, expense, net and transfers                                                                                                                                                                                                                                                          |
| `get_user_profile`               | Get the user's base currency, configured currencies with exchange rates, and basic profile info                                                                                                                                                                                                                                                                                |
| `list_transaction_attachments`   | List the files attached to a transaction (receipts, invoices): id, filename, mimeType, size in bytes and upload time                                                                                                                                                                                                                                                           |
| `search_transactions`            | Search and filter transactions                                                                                                                                                                                                                                                                                                                                                 |

### `subscriptions`

Recurring payments, their periods and candidates, and planned transactions.

| Tool                                  | Purpose                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get_planned_summary`                 | Totals of the planned (upcoming, not yet confirmed) transactions per account and currency: plannedDelta in the account currency, refPlannedDelta in the base currency, the number of plans and the latest plan date                                                                                                               |
| `get_subscription_by_id`              | Retrieve a single subscription by its ID including all linked transactions (with match source and date) and the computed next expected payment date                                                                                                                                                                               |
| `get_subscription_periods`            | List a subscription’s billing periods, newest due date first, with the status of each (upcoming, overdue, paid, skipped) and the transaction behind a paid one                                                                                                                                                                    |
| `get_subscriptions_summary`           | Aggregate summary across all active subscriptions with an expected amount, split by direction                                                                                                                                                                                                                                     |
| `get_subscriptions`                   | List all subscriptions and recurring bills for the user                                                                                                                                                                                                                                                                           |
| `get_upcoming_subscription_payments`  | List upcoming subscription payments sorted by next expected payment date (soonest first)                                                                                                                                                                                                                                          |
| `list_subscription_candidates`        | List auto-detected subscription candidates sorted by confidence score                                                                                                                                                                                                                                                             |
| `list_subscription_match_suggestions` | List past transactions (the last 12 months, at most 100, newest first) that a subscription’s matching rules would match but that are not linked to it yet                                                                                                                                                                         |
| `preview_subscription_payment`        | Preview what paying a subscription period would book: the amount in the account’s currency (converted at today’s rate when the subscription is billed in another currency), and, with periodId, the transactions already linked to the subscription that fall inside the period and could be linked instead of creating a new one |

### `budget-plans`

Budget plans with their groups, lines and line goals, and savings goals.

| Tool                                 | Purpose                                                                                                                                                                                                          |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get_budget_plan_period`             | Read one period of a budget plan: the figures behind the Budget screen                                                                                                                                           |
| `get_budget_plan_scheduled`          | List what is still scheduled in a period of a budget plan, from today on: subscription payments and planned transactions dated in the period                                                                     |
| `get_budget_plan_suggestion_context` | Read what a new budget plan could start from, before creating one: the top spending categories of the given accounts over the last three full months                                                             |
| `get_budget_plan_trends`             | Compare the last periods of a budget plan: for each, in order from oldest to newest, what was assigned, the activity (spending is negative), the amount carried in and what was available, in total and per line |
| `get_goals`                          | List savings goals (active, paused, archived) in the user's order                                                                                                                                                |
| `list_budget_plan_periods`           | List the periods of a budget plan, newest first                                                                                                                                                                  |
| `list_budget_plans`                  | List the budget plans (the "Budget" in the app: period envelopes where money is assigned to lines, not the trackers behind get_trackers), or read one with planId                                                |

### `trackers`

Spending trackers, their lines and suggestions.

| Tool                         | Purpose                                                                                                                                                                                                                                                                                                                                              |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get_tracker_spending_stats` | Get spending statistics for a tracker: spending broken down by category and a time-series of expense vs income over the tracker period                                                                                                                                                                                                               |
| `get_tracker`                | Get one tracker with its progress: the tracker itself (name, status, type, date range, limit, linked categories, and the share details when it is shared with the user) and its stats (income, expense and balance over the tracker period, how much of the limit is used, how many transactions it covers, and the first and last transaction date) |
| `get_trackers`               | List trackers: spending watchers over a date range with an optional limit, holding hand-picked transactions plus those their category and tag rules link                                                                                                                                                                                             |
| `list_tracker_suggestions`   | Smart-tracking state of a tracker the user owns                                                                                                                                                                                                                                                                                                      |

### `automations`

Transaction rules, payee aliases, ignored payee names and tag reminders.

| Tool                             | Purpose                                                                                                                                                                                                                      |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get_ignored_payee_names`        | List the names on the ignored list, newest first                                                                                                                                                                             |
| `get_tag_reminders`              | List tag reminders: rules that notify the user about the transactions of a tag, either when the tag total in a period passes an amount (amount_threshold) or when the tag has no transaction in the period (existence_check) |
| `get_transaction_automations`    | List the transaction automation rules (rules engine) of the user, ordered by evaluation order                                                                                                                                |
| `preview_transaction_automation` | Dry-run a set of automation conditions against up to the last 1000 eligible existing transactions and return { matchedCount, scannedCount, matches } where matches is capped at 5 sample transactions                        |

### `review`

Refund and transfer matches, duplicate cleanup and stuck pending transactions.

| Tool                              | Purpose                                                                                                                                                                                                                                                                                                                                     |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get_reconciliation_history`      | List the duplicate cleanups that removed transactions, newest first                                                                                                                                                                                                                                                                         |
| `get_refund_recommendations`      | Suggest transactions that a refund could be linked to: up to 5 of the opposite type (income for an expense, expense for an income) from the last 6 months, within 50 of the amount in the base currency, leaving out transfers, planned rows and rows that already act as refunds                                                           |
| `get_transfer_recommendations`    | Suggest the other leg of a transfer: up to 7 transactions of the opposite type (income for an expense, expense for an income) on other accounts, within 10% of the amount in the base currency and 14 days of the date, leaving out transfers, refunds, planned rows and split parents; same currency and closer amount and date rank first |
| `list_stuck_pending_transactions` | List bank-synced transactions that have been pending for more than 7 days, so the bank probably booked them under a different row                                                                                                                                                                                                           |
| `list_transfer_suggestions`       | Scan a period for expenses that look like one leg of a transfer between the caller's accounts                                                                                                                                                                                                                                               |

### `groups-templates`

Transaction groups and transaction templates.

| Tool                        | Purpose                                                                                                                                                                                                            |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `get_transaction_groups`    | List all transaction groups for the user                                                                                                                                                                           |
| `get_transaction_templates` | List the transaction templates: named presets the user fills a new transaction from (type, and optionally an account, a pinned amount, a category, a payee, a payment type, a note, an original currency and tags) |

### `investments`

Portfolios, holdings, securities, investment transactions and portfolio transfers.

| Tool                           | Purpose                                                                                                                                                                                                                                                                    |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get_investment_contributions` | Get the money moved into portfolios (net of withdrawals) per period, in the base currency, with the split per portfolio and the net savings of the same period for comparison                                                                                              |
| `get_investment_transactions`  | Investment transaction history: buy, sell, dividend, transfer, tax, fee, cancel, other                                                                                                                                                                                     |
| `get_portfolio_balances`       | Cash balances held in a portfolio, broken down per currency                                                                                                                                                                                                                |
| `get_portfolio_holdings`       | Positions held in a portfolio with dynamically calculated market value, cost basis, realized/unrealized gain (value and percent), and dividend income (net of fees, holding currency)                                                                                      |
| `get_portfolio_summary`        | Portfolio-level aggregates for a single portfolio: total current market value, total cost basis, realized and unrealized gains (value and percent), cash balances, and total portfolio value (holdings + cash)                                                             |
| `get_portfolio_value_history`  | Daily value history of one portfolio: total value, holdings value, cash, cost basis of open positions and cumulative realized gain per day                                                                                                                                 |
| `get_portfolio`                | Read one portfolio by id: name, portfolio type (investment/retirement/savings/other), description, enabled state and creation date                                                                                                                                         |
| `get_portfolios_overview`      | Overview of all portfolios in one call                                                                                                                                                                                                                                     |
| `get_portfolios`               | List the user's investment portfolios                                                                                                                                                                                                                                      |
| `get_security_prices`          | Stored closing prices of one security, found by securityId or by symbol with providerName (a security that is stored, even without a holding; not found otherwise), oldest first, each with the date, the close, when it was recorded and its source, as { prices, total } |
| `list_portfolio_transfers`     | Cash movement history of a portfolio: account↔portfolio transfers, direct deposits/withdrawals, linked bank transactions, and currency exchanges                                                                                                                           |
| `search_securities`            | Search for securities (stocks, ETFs, crypto, etc.) by ticker symbol or company name                                                                                                                                                                                        |

### `ventures`

Venture platforms, deals and events.

| Tool                        | Purpose                                                                                                                                                                                                      |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `get_venture_contributions` | Get the net amount contributed to each venture deal in a date range, in the base currency                                                                                                                    |
| `get_venture_deal_metrics`  | Compute aggregated metrics for a venture deal: cost basis, current value (latest NAV), total distributions, absolute and percent P&L, TVPI (total value to paid-in), DPI (distributions to paid-in), and IRR |
| `get_venture_deal`          | Retrieve a single venture deal by id, including its platform and currency                                                                                                                                    |
| `get_venture_event`         | Retrieve a single venture event by id, including its link rows (bank transactions linked to this event)                                                                                                      |
| `get_venture_platform`      | Retrieve a single venture platform by id                                                                                                                                                                     |
| `list_venture_deals`        | List the user's venture deals (private/illiquid investments through SPVs, syndicates, or direct vehicles)                                                                                                    |
| `list_venture_events`       | List events for a venture deal in chronological order (oldest first)                                                                                                                                         |
| `list_venture_platforms`    | List the user's venture investment platforms (SPV syndicators, fund managers)                                                                                                                                |

### `loans-vehicles`

Loans with their payments and notes, and vehicles.

| Tool                       | Purpose                                                                                                                                                         |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get_loan_balance_history` | The outstanding balance of a loan over time, in the loan currency: the opening balance followed by one end-of-day point per day that has payments, oldest first |
| `get_loans`                | List the loans (mortgage, auto, student, personal), or read one with loanId                                                                                     |
| `get_vehicles`             | List the vehicles (cars and other vehicles tracked as an asset), or read one with vehicleId                                                                     |

### `currencies`

Your currencies and exchange rates.

| Tool                        | Purpose                                                                                                                                                                                                                                             |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get_exchange_rate`         | Read an exchange rate for a day                                                                                                                                                                                                                     |
| `get_user_currencies`       | Get the currencies the user holds: baseCurrency (the reporting currency, null before one is set), currencies (every held currency with its settings: liveRateUpdate and exchangeRate) and exchangeRates (today's rate of each currency to the base) |
| `list_supported_currencies` | List every ISO 4217 currency the app supports, with its code, name and decimals                                                                                                                                                                     |

### `imports`

Import batches (list, undo) and bank connections (status, unlink an account); sharing is read only.

| Tool                             | Purpose                                                                                                                                                                                                                                                                                                                              |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `get_bank_sync_status`           | Read the sync state of the bank-connected accounts: the last automatic sync, a summary (total, syncing, queued, completed, failed, idle), per account its status, startedAt, completedAt and error, the connections that need reconnecting (connectionsNeedingReauth) and the consent state of every connection (connectionStatuses) |
| `get_import_batch_delete_status` | Read the state of the latest background import batch delete of the signed-in user, the job delete_import_batch starts for a batch above 1000 rows                                                                                                                                                                                    |
| `list_bank_connections`          | List the bank connections of the signed-in user (a bank or data provider linked to MoneyMatter), or read one with connectionId                                                                                                                                                                                                       |
| `list_import_batches`            | List the import batches of the signed-in user, newest first: every CSV, YNAB, statement, Wallet, MS Money and OFX import that still has transactions to undo                                                                                                                                                                         |
| `list_share_invitations`         | List the sharing invitations of the signed-in user: the ones they sent (every status: pending, accepted, declined, revoked, expired) and the pending ones addressed to them                                                                                                                                                          |
| `list_share_members`             | List who has access to an account, household or tracker the signed-in user manages: the owner and every member who accepted                                                                                                                                                                                                          |
| `list_shared_with_me`            | List the accounts, households and trackers other people shared with the signed-in user                                                                                                                                                                                                                                               |

<!-- END GENERATED TOOL TABLES -->

Call `get_user_profile` **first** — it reveals the user's base currency, which
is required to interpret `ref*` fields (refAmount, refBalance) that normalize
multi-currency data.

## Data conventions

- All monetary amounts are decimals (e.g. `42.50` means $42.50), not cents.
- Fields prefixed with `ref` are converted to the user's base currency.
  Use them for cross-account totals when accounts have different currencies.
- Transaction types: `income`, `expense`, `transfer`. Transfers are **not**
  income or expense — exclude them from spend/earn aggregations.
- The two legs of a linked transfer share a `transferId`; `get_transactions_by_id` with that
  `transferId` reads both. To find unlinked pairs, `list_transfer_suggestions` scans a
  period and `get_transfer_recommendations` suggests one transaction's other leg;
  `link_transfer` links a pair and `dismiss_transfer_suggestion` rejects a wrong one.
- A transaction's payee is set with `payeeId` (an id from `get_payees`; `null` clears it
  on `update_transaction` and `bulk_update_transactions`). `create_transaction` also
  takes `merchantName`, a raw merchant string resolved the way bank sync does: it matches
  an existing payee by name or alias and follows the instance's promotion rules, so a new
  payee may not appear on first sight. `payeeId` and `merchantName` exclude each other.
- Duplicate cleanup is reversible. `remove_duplicate_transactions` and
  `merge_duplicate_transactions` soft-delete rows, `get_reconciliation_history` lists
  them and `restore_removed_transactions` brings them back, but a restored row does not
  get back the tracker, group and subscription links it lost. Bank rows pending for over
  a week show up in `list_stuck_pending_transactions` with the booked row that likely
  replaced each.
- Deleting a transaction is reversible for 30 days. `delete_transaction` and
  `bulk_delete_transactions` move rows to Trash, where the user restores them in the app
  (there is no restore tool); after 30 days they are deleted for good. Rows in a payment,
  a portfolio or a venture cannot be trashed: `delete_transaction` rejects them and the bulk
  tool skips them, returning their ids in `skippedIds`.
- A subscription's `matchingRules` (`create_subscription`, `update_subscription`) link imported
  transactions to it automatically: `{ rules: [...] }`, every rule must pass. A rule is a note
  keyword list (`contains_any`), an amount range (`between`, optional `currencyCode` to match
  other currencies within 5%), a transaction type or an account (`equals`). An update replaces
  the whole list, `{ rules: [] }` turns matching off, and rules cannot be combined with
  `autoRecord`. `list_subscription_match_suggestions` shows what a rule set would match.
- A subscription period is one billing cycle. `get_subscription_periods` lists them,
  `preview_subscription_payment` shows what a payment would book, and
  `pay_subscription_period` either links an existing transaction or books a new one.
  `revert_subscription_period` undoes a payment and also deletes a transaction the app
  booked for it, so it needs `finance:delete` in that case; a transaction you linked
  yourself is kept.
- File bytes never travel through MCP tool arguments. To attach a receipt, call
  `create_attachment_upload_url`, then POST each file as the raw request body to
  the returned `url` with the returned headers plus the file's URI-encoded name in
  the `filenameHeader` header (needs shell/HTTP access to the file).
- Investment vs regular transactions are **separate datasets**.
  `search_transactions` returns regular (spending) transactions; investment
  activity (buy/sell/dividend/fee) lives in `get_investment_transactions` and
  does not appear in `search_transactions`.
- A multi-account payment is one income or expense paid from up to 5 accounts.
  `search_transactions` returns it as one row on its main account, with
  `paymentParts` (every account's part, main first) and `paymentTotal` (the sum
  in the main currency). Filtering by `accountIds` returns each account's own
  part instead. Use `paymentTotal`, not `amount`, for the payment's full cost.
  Set the parts with `paymentLegs` on `create_transaction` / `update_transaction`.
- Transaction automations are rules evaluated top to bottom by `position` on
  new transactions on bank-connected accounts or imported rows — never on
  transfers, planned ones, or transactions on manual (non-bank) accounts. Existing
  transactions change only when the user runs "Apply to past transactions" for a
  saved rule in the app. The first rule that applies an action wins. Test conditions with `preview_transaction_automation` before
  saving a rule, and pass the full current id set to
  `reorder_transaction_automations`.
- Tracker lines split a tracker's spending into named category sets, each with
  an optional limit. A transaction lands in at most one line: the first by
  `position` whose categories (expanded to children) contain it. Spending that
  matches no line is reported as `otherSpent` by `get_tracker_spending_stats`.
- Smart tracking (`aiEnabled`) is owner-only and works on trackers with an
  `aiDescription` and a `startDate`. The AI links transactions it is sure of
  (score >= 0.85) and suggests weaker matches (>= 0.5) as pending in
  `list_tracker_suggestions`. Rejected transactions are not suggested again.
- Savings goals count a percentage share of each backing account's balance
  (minus its credit limit, never below 0) toward a target in the goal's own
  currency. An account's shares across active and paused goals cannot pass
  100%; archiving a goal frees them. Goal writes need the Goals feature on the
  user's plan or an active trial.
- Portfolio queries are gated by `portfolioId`. Call `get_portfolios` first
  to discover ids before calling `get_portfolio_summary`,
  `get_portfolio_holdings`, or `get_portfolio_balances`.
- Portfolio cash moves via transfers: `link_transaction_to_portfolio` when the
  bank transaction already exists, `transfer_account_to_portfolio` /
  `transfer_portfolio_to_account` to create the transaction alongside the
  transfer, `create_portfolio_cash_transaction` when no account is involved,
  `transfer_between_portfolios` between two portfolios and
  `exchange_portfolio_currency` to swap cash currencies inside one portfolio.
  `set_portfolio_transfer_adjustment` keeps a correction out of the
  contributions report.
- A security reaches a portfolio in two steps: `search_securities` finds it,
  `create_holding` adds a result (passed unchanged as `searchResult`) and returns
  the `securityId` that `create_investment_transaction` needs. A known security is
  added with its `securityId` alone. `delete_holding` removes a holding with no
  quantity left; `force` also deletes its transactions.
- A venture event's cash is a set of bank transactions in the event's currency
  (their sum may differ from `lpNetAmount` by transfer fees): `link_transactions_to_venture_event`
  adds them, `replace_venture_event_links` swaps the whole set, and
  `delete_venture_event_link` frees one.
- A loan is an account with a payment plan. Its balance is negative while debt
  is outstanding, but `create_loan` and `update_loan` take the amount still owed
  as a positive decimal. `get_loans` carries the payoff projection (use it for
  payoff date and interest left). Payments are existing expenses recorded with
  `link_loan_payments`; a loan with payments cannot be deleted until
  `unlink_loan_payment` has undone them.
- A vehicle is an asset account whose value follows a depreciation curve from
  its purchase price and date. `get_vehicles` shows the estimated value in
  `account.currentBalance`. The purchase price, date and currency are fixed
  after `create_vehicle`; to set the value by hand, use `adjust_account_balance`
  on the vehicle's `accountId`.
- A budget plan (`list_budget_plans`, the "Budget" in the app) is a set of lines
  that money is assigned to period by period, with what is available carried
  from one period to the next. It is not a tracker: the tools named
  `get_trackers`, `get_tracker` and the like read trackers, a limit on a set of
  categories over a date range. Read a plan's periods with
  `list_budget_plan_periods`, then one period with `get_budget_plan_period`.
  Every plan amount is a decimal in the plan's own `currencyCode`.
  Only one plan is active at a time (`create_budget_plan` fails while another
  exists; trash it with `delete_budget_plan` or swap with `restore_budget_plan`
  and `replace`). Changing a plan needs a subscription that includes budget
  plans; trashing one does not.
  A plan holds lines (envelopes for categories, in groups). A category sits in
  one line at a time; archive a line before reusing its categories elsewhere.
  Money is assigned to a line per period with `set_budget_plan_assignment`
  (`from_here` sets a baseline that runs on, `this_period` a one-period
  override). A line's goal is set with `set_budget_plan_line_goal`; the
  combinations it accepts are listed in that tool's description.
- Sharing is read-only here, and bank connections are read-only apart from
  `unlink_account_from_bank_connection`. `list_share_invitations`,
  `list_share_members` and `list_shared_with_me` show who has access to what
  (never an invitation's accept link); `list_bank_connections` and
  `get_bank_sync_status` show the state of linked banks (never credentials).
  Inviting, accepting, connecting a bank and syncing are done in the app.
- Imports are run in the app; here you can list batches and undo one.
  `delete_import_batch` takes a batch id from `list_import_batches` and
  deletes every transaction the import created (it also reverses the balance
  the import absorbed and removes accounts it created that are now empty).
  A batch above 1000 rows answers with a `jobId`: the delete runs in the
  background and blocks writes until it ends, so follow it with
  `get_import_batch_delete_status`.
- The base currency lock: while a base-currency change runs (the user starts
  it in the app), the write tools fail with a "change in progress" error; reads keep working, except
  `preview_transaction_automation` and `list_transfer_suggestions`, which are
  refused too. A few writes that touch no amounts (attachments) are exempt. Wait for the change to finish, then retry. A read-only account (expired plan) can read;
  every write is refused whatever scopes were granted.
- Destructive calls are deliberately narrow. `bulk_delete_transactions` needs
  explicit `transactionIds` or at least one narrowing filter and refuses an
  empty filter (the REST API would trash everything); preview the count with
  `get_transactions_summary` first. Tools that delete only on one path
  (`ignore_payee_name` with `force`, `revert_subscription_period` when the
  app booked the transaction) need `finance:write`, plus `finance:delete` on
  that path.
- Bank connections, sharing writes, file imports and downloads, account groups,
  notifications, app settings, changing the base currency, the app's AI
  settings, billing, and deleting or wiping the account have no tools; send the
  user to the app for those.

## Troubleshooting

- **OAuth consent screen doesn't appear**: confirm the client fetched
  `/.well-known/oauth-authorization-server` and is using the advertised
  `authorization_endpoint`.
- **401 Unauthorized on tool calls**: the access token expired. The client
  should use the refresh token (granted via `offline_access` scope) to obtain
  a new access token.
- **Revoking access**: user goes to MoneyMatter → Settings → AI → Connectors (MCP)
  and removes it from Active connectors.

## Self-hosted deployments

Users who self-host will have their own MCP URL (e.g. `https://mcp.my-domain.tld/mcp`).
Ask the user for their deployment URL before assuming the public endpoint.
