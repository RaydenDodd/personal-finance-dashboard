# Google Sheets synchronization

The implementation uses the existing MoneyMatter backend, reporting snapshots, principal ledger and PostgreSQL backup system. It adds no separate service or paid connector. Historical balance authority switches on **2026-11-05**; manual balances and offline imports remain available permanently.

## Current operational status

The existing imported history contains **650 balances, 44 recorded dates and 16 reporting accounts**. It remains available without Google access and after any bank disconnection. Both synchronization directions, idempotent retries, dated contribution notes, formula protection and concurrent-edit conflicts have been tested with synthetic Sheets transport fixtures.

**Live unattended Google Sheet → MoneyMatter and MoneyMatter → Google Sheet synchronization are pending durable Google credentials on the Pi.** Codex's connected Google Sheets access can support an authorized one-time reconciliation, but it does not grant the deployed backend an offline token. Missing credentials are shown as Connection required; manual saves do not depend on a successful Google request. Do not describe a configured mapping or a passing fixture test as a successful live Google synchronization.

## Daily use

Open Personal net worth → Google Sheets synchronization to inspect connection status, last attempt/success, prepared writes and unresolved conflicts. Automatic synchronization runs every five minutes when enabled and authorized. Sync now uses the same guarded process. Verified SimpleFIN balance mirroring is a separate opt-in setting; personal manual balances and contributions do not require a bank connection.

Personal net worth defaults to Automatic + personal records. Personal records only excludes provider snapshots while retaining manual, Sheet and CSV records. Through date, the period controls, the account-history selector and dated details expose actual historical observations. Record balance creates a dated verified valuation; Correct selected balance appends an audited revision. Saving refreshes related charts. CSV import remains available for offline or unsupported accounts.

## One-time authorization

Use either owner-authorized Google OAuth offline access or a service account with editor access to the existing spreadsheet. Google secrets belong in the ignored Pi environment, a private mounted credential file or encrypted database credential storage. Never commit them or place them in frontend environment variables.

For credential setup from the development computer, retain the existing SSH tunnel and open the application at `http://localhost:8095`:

```powershell
ssh -N -L 8095:192.168.0.32:8095 cardgames-pi
```

This carries application traffic over SSH and matches the default registered OAuth callback. A credential file supplied to the server must be inside its container or explicitly mounted there; a Windows path cannot be read by the Pi container.

### Google OAuth

Configure a Google OAuth client with these backend variables:

```dotenv
GOOGLE_SHEETS_CLIENT_ID=<OAuth client ID>
GOOGLE_SHEETS_CLIENT_SECRET=<OAuth client secret>
GOOGLE_SHEETS_REDIRECT_URI=http://localhost:8095/api/v1/personal-finance/sheets-sync/oauth/callback
```

Register the exact callback URI with that client. The implementation accepts HTTPS redirects or HTTP loopback redirects, not a plain HTTP LAN callback. Existing `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` can provide the client configuration if appropriate, but ordinary Google sign-in is not the offline Sheets authorization grant.

Connect Google starts an owner-session OAuth flow with PKCE, a short-lived state token, the `https://www.googleapis.com/auth/spreadsheets` scope and offline consent. The callback validates state/expiry and stores the refresh token using the application's credential encryption. Alternatively, an operator can supply an existing valid `GOOGLE_SHEETS_REFRESH_TOKEN` with the matching configured OAuth client. The API never returns refresh tokens to the browser.

### Service account

Share the existing spreadsheet with the service account's email as an editor. Use the Google Sheets panel's service-account JSON key upload, which accepts the downloaded `client_email` and RSA `private_key` fields. The backend validates and encrypts the credential; the key is not rendered or retained in browser storage. The status API can identify the service-account email without disclosing its key.

An operator can instead mount a private key file and set `GOOGLE_SHEETS_SERVICE_ACCOUNT_FILE` to its path inside the backend container. Environment-file authentication and owner-upload authentication are alternatives. The existing Docker Compose backend reads `.env.pi.local`; only recreate that backend when a new environment configuration needs to take effect.

The Google Sheets API must be usable by the selected Google project and credential. After authorization, save the existing account mappings, enable automatic synchronization and run a live test before relying on scheduled writes. A connection or permission failure leaves manual records intact and exposes a status error.

## Layout and account identity

The synchronizer targets the existing Networth Calculator layout:

- Recorded balance dates in row 3 and account balances in rows 4–19.
- Investment/retirement principal account rows 49–56, savings principal account rows 64–66, with contribution cells beginning in column E.
- Explicit reporting-account IDs linked to the appropriate balance/principal rows, with expected row labels to detect a moved or renamed mapping.
- Existing historical combined/renamed identities retained. A combined current M1 value is not split into invented historical component values.

Snapshot dates use the actual date cell, not a visual year heading. Missing dates/values remain absent; numeric zero remains a real value. Amounts are normalized to USD cents. A new balance date is placed after the occupied balance timeline, extending columns when needed. Existing row structure, formatting and formulas are retained. Principal additions use a verified contribution date in the native cell note, not a substitute comment or a guessed month.

Mapping changes are deliberate configuration changes. They reset the synchronization comparison baseline and block obsolete prepared writes while preserving original snapshots, contributions and audit records. They do not guess that a newly positioned row represents the previous account.

## Balance source precedence

Before November 5, 2026, provider snapshots do not replace historical Sheet/import valuations. From the cutoff onward, verified provider observations are primary for automatically managed accounts. Effective dates come from the provider; the time a poll ran does not become a new effective date.

Within one account/date, verified manual corrections remain highest priority. For automatic management, verified provider balances outrank ordinary imported fallback values; choosing manual management changes that preference without deleting provider records. Equal-quality corrections choose the latest revision. Every source revision remains in the audit trail. The cutoff does not prohibit later manual fallback or explicit historical corrections.

An account or category total is not duplicated because both a manual and provider record exist. Historical rows representing combined accounts retain their original aggregate meaning. The native account Balance history tab shows source labels, actual dates, combined principal/value when available and correction links. Aggregate principal/gain is unavailable if any active component lacks a complete basis.

## Loop and conflict handling

Synchronization tracks source cell identities, effective account/date, snapshot or cash-flow IDs, cell fingerprints and a durable prepared-write outbox. A Sheet import acquires a comparison baseline and is not written straight back as a second dashboard edit. A dashboard-origin write records its source marker so the following Sheet read is recognized as the same change.

Before an external write, the synchronizer re-reads the target cells and verifies the expected prior fingerprint and current source revision. An independent edit made after planning blocks the stale write. A successful write is read back before its operation is marked complete. Retries recognize prior source markers rather than appending duplicate values or contributions.

Independent edits to the same balance retain both versions and create an explicit conflict. The owner can select the verified Sheet or dashboard value; an existing Sheet formula cannot be replaced by a dashboard value. A changed verified principal entry requires contribution-evidence review and an audited ledger correction rather than silently changing a native bank transaction. Unknown or yearless contribution notes remain review issues until their actual dates are verified.

Local valuations and ledger entries remain durable during a Google outage. Queued changes counts already prepared external writes, not every saved local record. The next authorized poll compares the current local evidence with the current Sheet before preparing writes, avoiding a blind replay of stale data.

## Principal and transfer evidence

The principal ledger retains source identity, dated evidence, verification, native transaction references, employee/employer kind where supported and replacement references for corrections. Repeated CSV, Sheet or bank-transfer imports are idempotent. A recurring payroll schedule can identify a period that needs review; it cannot prove that a contribution posted or establish its amount.

A known principal checkpoint is an as-of record rather than an invented inception payment. Its verified-through coverage controls whether later gains can be calculated. An incomplete checkpoint remains visible as known principal while principal-based gains are unavailable. Dividends, reinvested dividends, interest, asset purchases and merchant expenses are not external contributed principal. Employee and employer components are separated only by explicit evidence.

Confirmed transfers from owned spendable accounts to savings/investment accounts can create destination principal. Transfers between owned savings/investment accounts move principal without increasing aggregate principal or ordinary income. Original bank transactions and their existing transfer links are preserved. Ambiguous destinations are reviewed; a confirmed exact-description mapping can be reused for future imports from the automation cutoff. Insurance and other genuine merchant payments remain expenses.

Verified future ledger contributions write their amount and actual date into the correct principal row. The native note includes the MoneyMatter cash-flow identifier and available source transaction reference. A retry or subsequent Sheet import recognizes that marker. Corrections preserve prior note evidence, and protected formulas or independently edited cells become conflicts instead of being overwritten.

## Recovery and validation

Use the existing PostgreSQL backup/restore process for complete recovery of snapshots, principal references, source baselines, prepared writes, conflicts and encrypted credentials. Upstream's in-app export does not include every custom reporting/synchronization table. Keep the credential-encryption key and any external credential file in the private recovery material; the database alone cannot recover a missing external key file.

Synthetic tests cover both balance directions, no-loop repeats, contribution notes/markers, source precedence, manual corrections, incomplete principal coverage, timeline extension, formula protection and edits made during a planned write. Live Google authorization, permission and two-direction write/readback checks remain a separate activation step. No subscription, Google credential or bank connector is purchased by setup.
