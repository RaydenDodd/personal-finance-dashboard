# Shared financial color registry

`packages/shared/src/financial-colors.json` is the canonical user-selected palette. TypeScript charts read it through `@bt/shared/financial-colors`; the scheduled Python report renderer reads the same JSON. `installFinancialColors` exposes financial CSS variables independently of the UI brand tokens. Net worth follows the selected light/dark foreground identity; all other financial roles retain their colors across themes.

Income allocation separates savings, investments, retirement, taxes and spendable money while adapting the existing calculation result. Detailed payroll categories use their designated shades, including employer matching under retirement. Before-tax and after-tax remain attributes. Portfolio shades use persistent identities rather than list position, so sorting and filtering retain colors. Generic gain/loss status colors, merchant/transaction category colors and branding remain independent.

Applied to Income summaries, salary and received-pay charts, allocation doughnut/Sankey/breakdown, income reports/projections, Personal Finance categories, net-worth history and drivers, investment analytics and security/allocation charts, investment contributions, balance trend and relevant dashboard summaries. No stored category colors, financial records or calculations are migrated.

## Scheduled email

Tuesday delivery retains the existing owner recipient, timing, sync/classification prerequisites and duplicate-send protection. Mail is multipart plain text plus email-compatible HTML. HTML includes week/weekend cards, purchase-by-day bars, original transaction-category color breakdowns, refund amounts, review items, and incomplete-data warnings. The weekend is explicitly a subset of the week. Existing cached reports without daily fields remain readable. No JavaScript or external tracking assets are required. Email clients can vary in cosmetic rendering.

No test email is sent by deployment. A live preview must render an existing report without calling `prepare`/`preview`, which also invoke classification. Use `python -m unittest discover -s deploy/local-finance -p test_report_visuals.py` for isolated renderer checks.

## Verification notes

Targeted financial-presentation tests preserve allocation, contribution and net-worth totals and check stable colors. Two unrelated existing component assertions currently expect older behavior: payroll date-range presets always visible rather than the current compact control, and portfolio comparison forced to dollars rather than the current percent option. Their production behavior was not changed as part of this color task.

## Presentation exceptions requested after rollout

Investment allocation, portfolio comparisons, sector/geographical allocation and benchmark comparisons retain the original varied categorical palette for readability. Value versus invested capital retains contrasting lines. Dividend charts/calendar and the net contribution trend use yellow accents. Before-/after-tax projected breakdown headers use purple; detailed rows retain their financial-role colors. Cash Flow summary values use income green, expense red and savings gold; savings rate uses green/red by sign. Planned pace summary values are neutral gray. These exceptions do not modify stored transaction categories or calculations.
