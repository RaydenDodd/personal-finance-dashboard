# User-initiated MyADP payroll updates

The internal MyADP endpoints used by the employee website are separate from ADP's developer/Marketplace APIs. Your supplied exports establish that these endpoints return your records after normal employee authentication. That is technical evidence, not a guarantee that an undocumented interface will remain available or that ADP approves third-party account access.

ADP's [employee terms](https://netsecure.adp.com/public/legal/TermsCondition.html) permit individual account use and restrict unauthorized third-party gathering; the [general terms](https://www.adp.com/legal.aspx) distinguish express-consent, nonscheduled collection from excessive requests. They do not provide an explicit integration contract for these undocumented endpoints. This release therefore uses an assisted personal export/import workflow. No server logs into ADP, runs scheduled collection, receives credentials, bypasses MFA or claims a supported ADP API connection.

## Normal workflow

1. In Actual Income choose **Manage payroll → Sync ADP payroll**. The update reminder defaults to 30 days and never starts a provider request by itself.
2. Open the official ADP website and sign in/MFA directly. Download your personal payroll JSON or paystub PDFs through your own session.
3. Import the file in **Manage payroll → Import payroll files**, select the correct employment, preview and confirm. The importer compares source-scoped statement IDs, updates changed statements with previous revisions retained, and skips exact duplicates.
4. Sign out of ADP when finished. Successful imports are recorded separately from provider syncs; opening a website, canceling or failing import never records a successful sync.

## Optional local, temporary-browser export helper

On a computer with this repository and its existing Playwright dependencies, run:

```powershell
node scripts/export-adp-payroll.mjs --output private/adp-payroll-export-new.json
```

The helper opens a new, nonpersistent Edge window (Chromium on other systems). Authenticate on the official site yourself and open Pay statements. Only after you type `EXPORT` does it use your own temporary page's same-origin `fetch` for the history and individual statement URLs supplied in the request. If the worker identity cannot be observed from that page's pay-statement requests, you may enter it locally; it is never a MoneyMatter setting.

It makes sequential read requests, stops on non-JSON responses, access denial, authentication failure, redirects or rate limits, has no automatic retry or background timer, and refuses to overwrite an existing export. Session cookies remain inside the isolated browser context. The context and browser close in `finally` on success/failure/cancel; no passwords, MFA inputs, cookies, tokens, persistent profiles, tracing or screenshots are read/saved. Closing discards this local session but does not promise server-side token revocation or sign out other browser sessions. A fresh owner-operated sign-in/MFA and export succeeded on November 20, 2026. ADP may still refuse automation or change its internal JSON shape. Stop if ADP denies access.

Adjustment status can appear only in the history response. The helper merges that explicit boolean into each detail record and stops if the status is missing, invalid or conflicting. It does not infer an omitted status as false.

Use only where your account/employer's applicable rules permit personal export. The existing imported files remain the supported fallback. An extension can perform similar same-origin export with user-click active-tab permissions, but a normal shared browser tab cannot guarantee an isolated session is destroyed; no extension, local listener or remote browser was installed.

The internal read-only resources are:

```text
https://my.adp.com/myadp_prefix/payroll/v1/workers/{workerId}/pay-statements?adjustments=yes&numberoflastpaydates=160
https://my.adp.com/myadp_prefix/payroll/v1/workers/{workerId}/pay-statements/{statementId}
```

No worker IDs or authenticated request headers belong in source control, logs, screenshots or bug reports.

## Connection status and live verification

The current status is **Assisted export**, not a direct ADP connection. **Sync ADP payroll** opens the instructions; it does not launch a local program from the webpage. The local helper must be started on your computer using the command above. A browser webpage cannot start that local command without an installed bridge, and no bridge was installed.

| Step                               | Current implementation                                                               |
| ---------------------------------- | ------------------------------------------------------------------------------------ |
| Open Sync ADP payroll              | Opens the update instructions and official ADP link                                  |
| Launch the isolated export browser | Run the local helper command                                                         |
| Sign in and complete ADP MFA       | You do this directly in the official ADP window                                      |
| Fetch payroll statements           | The helper performs sequential same-origin reads after you type `EXPORT`             |
| Import into MoneyMatter            | Select the export file, verify the employment, preview, and confirm in Actual Income |
| Close the ADP session              | The isolated browser closes on export completion, failure or cancellation            |

On November 20, 2026, the owner signed in and completed MFA directly in the temporary Edge window. The helper retrieved all 72 detailed statements and closed its browser. MoneyMatter recognized all 72 as duplicates: zero inserts, zero updates and zero rejected records. Payroll amounts, existing statement versions and the original Income plan were unchanged; the successful-import date and update reminder advanced. No existing browser cookies were copied.

That live test exposed detail responses omitting adjustment flags supplied in history. The raw export was retained unchanged. For this refresh, the two existing adjustment flags were preserved using previously verified history only after all other normalized financial fields matched exactly. The helper was then corrected to merge current history metadata in future exports; all 12 focused transport/cleanup/metadata tests passed. The corrected metadata merge was tested with synthetic responses, without requesting another live sign-in.

For future updates, run the helper with a new private filename, sign in/MFA in its window, open Pay statements, and type `EXPORT` in the terminal. Then use MoneyMatter's import preview. An unchanged export should show duplicates without new financial records. If ADP denies access, returns a login page or rate-limits requests, stop; use the existing file-import fallback. Imported statements remain private and the recorded successful-import date is separate from provider-sync status. The website-to-local-helper launcher remains unimplemented; this verified workflow is still assisted export, not a direct or scheduled ADP connection.
