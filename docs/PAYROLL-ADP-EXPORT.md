# User-initiated MyADP payroll updates

The Windows companion connects the **Open ADP and sync** button to a fresh, temporary Microsoft Edge browser. Sign in and complete MFA directly at ADP. Once Pay statements opens, the helper retrieves detailed payroll JSON, closes that browser, and passes only payroll records back to the initiating MoneyMatter tab. MoneyMatter previews all employment groups before importing them through its existing authenticated payroll importer. Known statements retain their verified employer; the visible employment choice applies to newly encountered statement IDs. Unchanged records are skipped and corrected statements retain their earlier revisions.

No MoneyMatter server signs into ADP. There is no scheduled ADP collection, localhost listener, public API exception, stored password, MFA code, cookie export or persistent ADP browser profile. The existing 30-day reminder asks you to start an update. The iPhone displays imported records but cannot run this Windows companion; file import remains available.

## One-time Windows setup

Requires an existing Node.js installation and Microsoft Edge. The package is generated from repository source, including the existing Playwright Core dependency, by:

```powershell
node scripts/adp-companion/package.mjs --publish
```

The normal frontend prebuild also generates `/downloads/moneymatter-adp-companion.zip`. Extract the archive and run `install.ps1`. This installs the host under `%LOCALAPPDATA%\MoneyMatter\ADPCompanion` and registers it for the current user in Edge and Chrome. It does not install a background service or require administrator rights.

In `edge://extensions` (or `chrome://extensions`), enable Developer mode, select **Load unpacked**, and choose `%LOCALAPPDATA%\MoneyMatter\ADPCompanion\extension`. Reload MoneyMatter. Browser installation is an explicit owner action; no policy or security setting is used to force installation. The extension has only `nativeMessaging` permission, with no access to your ordinary tabs or cookies. Only the top-level `https://raydenfinance.duckdns.org` page may invoke it. The native host accepts only the pinned companion extension identity.

## Each update

1. Open Actual Income → Manage payroll → Sync ADP payroll.
2. Check the employer for new paychecks and click **Open ADP and sync**.
3. Authenticate and complete MFA yourself in the official ADP window. If needed, open Pay statements.
4. Wait for automatic retrieval, validation and import. Success closes the dialog and reports new, corrected and unchanged statement counts. The temporary ADP browser closes before the export is returned.
5. Cancel or close the dialog to stop further work and close the temporary browser. A request already accepted by MoneyMatter may finish; repeated imports skip unchanged records.

All employment groups must pass preview before any write starts. They then commit sequentially using the existing revision checks. If a later group conflicts or connectivity fails, completed groups remain preserved and a retry is safe. It is not a cross-employment transaction. No successful sync is claimed if retrieval or import fails. The importer continues to record successful imports separately from supported provider synchronization.

## Access and technical limits

The internal MyADP endpoints are distinct from ADP's developer or Marketplace API:

```text
https://my.adp.com/myadp_prefix/payroll/v1/workers/{workerId}/pay-statements?adjustments=yes&numberoflastpaydates=160
https://my.adp.com/myadp_prefix/payroll/v1/workers/{workerId}/pay-statements/{statementId}
```

The helper observes the worker identity from the website's own history or detail activity, including cached payroll resource paths. It never exports resource query strings, request headers or session state. It then verifies the history and each detail through sequential same-origin JSON reads, stops on denial, non-JSON responses, redirects, identity conflicts or rate limits, and never retries access automatically. Download progress reports only completed/total counts. It retains explicit adjustment metadata from history when detail omits it. Only whitelisted payroll fields leave the page; no authenticated request headers or worker IDs are logged or stored in MoneyMatter settings.

ADP's [employee terms](https://netsecure.adp.com/public/legal/TermsCondition.html) permit individual employee access and restrict unauthorized third-party gathering. Its [general terms](https://www.adp.com/legal.aspx) discuss express-consent, nonscheduled collection. Neither supplies an integration agreement for these undocumented endpoints. This is an owner-operated personal export bridge, not an ADP-supported integration or a guarantee of permission for every employer/account. Use it only where your applicable rules permit personal export. No authentication, MFA, access restriction or browser safety barrier is bypassed. If ADP refuses access or changes its interface, stop and use file import.

The browser context and process close on success, failure, timeout and cancellation. Discarding the local session does not promise server-side token revocation or sign out other browsers. The window allows up to ten minutes for login and a fifteen-minute overall limit. The extension assembles a bounded, ordered export in memory; partial or conflicting exports are rejected. It never persists the export in extension storage. Only one update runs at a time.

## Verification status

The previous owner-operated CLI test on November 20, 2026 retrieved all 72 detailed statements and closed its isolated Edge browser. The live importer recognized all 72 as unchanged: zero inserts, updates or rejected records. The two adjustment flags and existing payroll amounts were preserved.

The owner installed the extension and confirmed a successful button-to-companion update on November 20, 2026: ADP closed and MoneyMatter reported success. An authenticated readback verified all 72 stored statements remained identical to the predeployment fingerprint; only import-run/reminder metadata advanced. The button flow is distinct from the earlier CLI export. The first reported attempt appeared stuck at Pay statements, so discovery now handles detail views and cached payroll resource paths and shows bounded completed/total download counts. Real Edge tests verify history, detail-only and cached-resource discovery, same-origin reads, progress and temporary-browser cleanup without contacting ADP again.

The standalone fallback remains:

```powershell
node scripts/export-adp-payroll.mjs --output private/adp-payroll-export-new.json
```

Sign in/MFA yourself, open Pay statements, type `EXPORT` in that helper, then import the resulting file through MoneyMatter. The fallback refuses to overwrite an existing export. Payroll exports, worker IDs and authenticated headers must stay out of source control and bug reports.
