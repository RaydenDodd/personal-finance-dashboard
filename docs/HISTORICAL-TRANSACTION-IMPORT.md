# Historical transaction reconciliation

Historical card, checking, and savings exports use the same `Transactions` records as the existing Spending, Expenses, Income, merchant, category, and dashboard reports. They do not create a second ledger or account-balance history. No migration is required.

The explicit workflow is available at authenticated `POST /api/v1/import/historical/preview` and `POST /api/v1/import/historical/execute`. It accepts already audited, normalized rows for **existing, owner-matched SimpleFIN cash, savings, and credit-card accounts**. General CSV imports retain their existing bank-account restriction. Investment and system accounts are rejected by this historical workflow.

## Preparation and review

Keep originals, file hashes, account mappings, inventories, previews, backups, and reports in ignored private storage. Inspect every worksheet; summaries, headers, and zero-value notices are not cash movements. Never infer an account from a similar filename alone. A replaced card number requires reliable account evidence or an owner-confirmed alias.

Amounts are signed integer cents. `date` is the actual transaction day, with an optional separate `postedDate`. Source evidence includes a SHA-256 file hash, worksheet, row number, source category, reliable bank identifier when available, and a stable transaction key. Keys must represent a transaction or a distinguishable occurrence, rather than the filename. Repeated payment-channel labels are not transaction identifiers.

Optional `merchantName` retains the normalized source merchant separately from the original description. Optional `payeeId` links an already matched owner payee through canonical creation and its existing rules. Uncertain merchant identities are not assigned to a guessed payee.

Each preview accounts for rows as `new`, `existing`, `source-duplicate`, or `review`. Identifier conflicts, ambiguous duplicates, and pending/posted conflicts stay held. `reviewReason` explicitly holds an unresolved source or income classification. Execute requires the returned preview digest, locks accounts in a stable order, and recomputes the preview before writing. A changed preview is rejected.

Reconciliation considers account, signed amount, transaction and posting dates, merchant description, source identifiers, and source occurrence counts. Exact days take priority over nearby dates. Processor labels are normalized while merchant digits are preserved. Substantial statement-name prefixes can match appended city or terminal information. Loose substring/edit-distance guesses do not authorize inserts or merges. One source file cannot consume the same unidentified occurrence repeatedly; overlapping files may cite the same canonical record.

## Writes and preservation

Execution reuses the existing import-batch audit and canonical transaction creation service. Original source evidence is stored in `externalData.historicalSources`, beside existing `importDetails` and provider metadata. Matching an existing transaction adds evidence without replacing its identity, date, amount, category, payee, transfer link, original provider identifier, or user correction. Provenance writes use a scoped metadata update without balance hooks.

New rows keep the account's actual SimpleFIN type, so the existing account and balance hooks do not apply imported cash movements to live balances or historical balance snapshots. The workflow never creates accounts, changes inclusion settings, fabricates an opposite transfer leg, or invokes opening-balance reconciliation.

Existing user, payee, and subscription categorization rules remain available through canonical creation. An imported category is a fallback suggestion. Reclassification of existing Other records is separately previewed and applied through existing supported rules, with manual corrections, locks, splits, investment records, and uncertain classifications protected.

Recognized one-sided payments and internal movements use `transfer_out_wallet`. Supported refunds use the existing refund ledger. Originals may be referenced by canonical transaction ID or source key and are linked after all rows exist, regardless of export order. A missing original remains explicitly unlinked; no purchase is fabricated. Income's existing payroll adapter reconciles net bank deposits with ADP evidence without rewriting gross, tax, or retirement records.

Later SimpleFIN creation checks historical records under the same account lock. A uniquely supported match gains the real provider identifier and nonblank provider metadata while retaining its transaction identity and classifications. Ambiguity raises a visible reconciliation conflict instead of inserting a possible duplicate. Original provider-ID deduplication remains in place.

## Validation and operation

Before production writes, verify the deployed revision, create a validated database backup, restore it into a separate database, disable external connections only in that clone, and exercise the actual HTTP workflow there. Compare protected tables and all existing financial identities. Execute the same complete import again and require zero new transactions.

Apply only the reviewed payload, retain every held row with a reason, and record actual per-file results. Check representative historical years through the existing transaction and analytics endpoints and date controls. MAX uses the earliest enabled-account transaction; the balance-history automation cutoff must not be changed to expose transactions.

The existing import-batch undo restriction for bank-linked accounts remains in force. Do not work around it by unlinking accounts or altering balances. Recovery requires the established backup procedure and a separately reviewed correction.

Tests are colocated with the historical service, matcher, provider reconciliation helper, and controller. The endpoint integration tests cover older dates, repeat execution, overlap and occurrence counts, a normal export exceeding the default JSON limit, invalid accounts/dates, stale previews, and one-sided transfers/refunds. On Windows, the unit-test command may need an explicit `--testMatch` glob because the default glob can resolve incorrectly. Full repository E2E execution requires its Docker/bash environment; a passing empty test run is not validation.
