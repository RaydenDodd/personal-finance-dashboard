# Stable upstream integration ? November 20, 2026

Integrated letehaha/moneymatter main at 5f84f0f50 (v0.33.20) into the customized dev branch. Upstream has no master branch. The newer development branch is deliberately excluded, including its decimal-money migration.

Preserved the custom historical-import reconciliation and MCC enrichment, payroll and Windows ADP companion, Public provider, principal/balance provenance, savings-funding calculations, original Trends comparisons plus added pace charts, mobile chart dismissal and PWA navigation, hidden-account preferences, public gateway authentication, and default read-only MCP access.

Compatibility decisions:
- Retain the customized Annual Overview components rather than replacing the original comparisons with the upstream redesign.
- Adapt the custom SimpleFIN history protection to upstream shared persistence. Reconciled historical records are never re-emitted for automatic recategorization; MCC enrichment preserves existing provenance and corrections.
- Keep custom origin-aware authentication while exposing the upstream social-provider metadata and OAuth toolset scope definitions. Write tools remain disabled by default and omitted from read-only metadata.
- Retain the legacy shared doughnut used by custom Income alongside upstream shared widget components.
- Build application bundles on Windows. Refresh native ARM64 runtime dependencies separately; never compile the application on the Pi.

Validation: backend/frontend typechecks and production builds; 205 targeted backend tests plus two historical-persistence guard tests and two metadata tests; 571 frontend tests passed, including reruns after resolving one upstream expectation that conflicts with the explicit transfer-exclusion requirement and a Node 26 test-host web-storage compatibility issue. Lint passes with pre-existing warnings. A restored, disconnected database passed all upstream migrations with exact record fingerprints unchanged across 33 financial tables. Bounded authenticated account, transaction, payroll and savings-pace checks passed.

Operational notes: repaired an interrupted older Debian package configuration and installed all pending APT upgrades. Docker restarted during its package upgrade; services recovered. Bootloader is current. No unbounded analytics query or financial backfill is part of this update. Kernel memory accounting is currently disabled, so Docker memory ceilings are not enforced; a separate controlled boot-configuration/reboot follow-up is needed. This update does not claim to resolve earlier Pi hangs.

Release-specific backup names, image identities and live verification are recorded in the ignored private maintenance report.

Final live checks also exposed a pre-existing American Express sync failure: the historical matcher used decimal dollars in a BIGINT cents predicate. The lookup now explicitly compares integer cents; a generated-SQL regression covers $7.71 ? 771. The scheduled fallback now waits up to six minutes (eight-minute service ceiling), allowing upstream?s five-minute provider timeout to complete. No stored amounts or category corrections are rewritten by this fix.
