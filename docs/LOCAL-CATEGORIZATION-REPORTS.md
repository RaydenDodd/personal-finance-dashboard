# Local categorization and Tuesday spending reports

This installation uses a small local multinomial naive Bayes text classifier, not an LLM or agent. It needs only Python 3.11's standard library. Training and inference run briefly on the Pi. Transaction data is not sent to an AI provider, and there are no inference API fees.

Rules run before the learned model: explicit confirmed merchant corrections, consistent earlier merchant history, bank-supplied MCCs, common merchant names, sourced local venues, and whole-word name hints. Mixed-purpose stores and bars can sell food; their generic merchant hints require review. The naive Bayes score is **not calibrated confidence**. Learned-model output remains a suggestion, and only deterministic eligible matches may update uncategorized purchases. Existing categories, manual/rule choices, transfers, splits and locked payees are preserved. Only the latest 45 days are considered for updates. The original Google Sheet is not touched.

## MCC data

SimpleFIN's optional `mcc` field is retained in the existing transaction `externalData.mcc` JSONB field. The REST transaction response exposes `mcc` as nullable four-character text and the transaction editor displays it read-only when present. This is durable storage using the existing schema; no new migration is needed. Leading zeroes are preserved. Invalid/missing codes stay null; a later blank response does not erase a known bank code. Resync enriches an already imported row without replacing its category. The one-time backfill only changes that metadata, matching owner, linked account and original transaction ID.

MCCs describe the merchant's business, not the purchased items. The bank/aggregator may omit them from the feed even though card processing used a code. SimpleFIN does not guarantee the field, and coverage varies by institution and transaction type. The application cannot recover codes that were not supplied. The checked Discover and Capital One data had empty codes; Attune supplied codes. Codes like `0012` are retained as reported, but are not mapped to a guessed category.

## Schedule (America/New_York)

- `finance-classify.timer`: daily at 02:00, before the existing Monday 03:00 reboot. Persistent catch-up is enabled for missed classification.
- `finance-report-prepare.timer`: Tuesday 08:40, queues or joins bank sync, waits up to three minutes for fresh per-account completion, then runs local categorization and stages the report.
- `finance-report-send.timer`: Tuesday 09:00, sends a prepared report from the last hour. If preparation is missing or stale, it sends an unavailability notice with no invented totals. Reports cover the previous Monday–Sunday, with a separate Friday–Sunday subtotal. These are local-date intervals with exclusive end dates and DST-aware conversion.

If banks fail or time out, the report visibly warns that available posted data may be incomplete. Pending purchases are counted separately. Transfers, recognized investment movements, balance adjustments and excluded accounts do not count toward spending. Linked refunds reduce net spending and are shown separately. No unknown FX conversion is invented. Apparent duplicate records are flagged rather than deleted. Mail includes purchases still categorized Other, their suggestions, and a link to review transactions.

The send timer is not persistent: it does not send an unexpected old report after an extended outage. It uses sent/pending markers plus a stable Message-ID to suppress duplicate delivery. An ambiguous SMTP outcome requires review, rather than an automatic resend. SMTP acceptance is not proof that the recipient's inbox accepted or displayed the message.

## Private configuration and recovery

Install owner API credentials at `/etc/finance-operations/owner.json` and SMTP configuration at `/etc/finance-operations/email.json`, root-owned mode 0600, inside a mode-0700 directory. Use a dedicated Gmail app password or SMTP credentials, not the normal account password. Do not commit either file. The authorized recipient is `tiggerdodd3@gmail.com`. Changing that recipient requires an explicit configuration/code change.

State, before-images, predictions and reports live in `/var/lib/finance-reports` with root-only access. `applied.json` excludes the classifier's own unchanged labels from future training. A changed category or later manual correction can become new evidence. Before-images are saved before writes and each update is re-read. A shared flock prevents nightly/report jobs from overlapping.

Explicit corrections can be stored in `confirmed-merchants.json` under the state directory as an array of `{ "merchant": "merchant name", "category": "existing category name" }`. They affect production prediction only; the historical blind evaluation disables these current overrides. All categories must already exist; this system does not split, merge or invent categories.

Install the three service/timer pairs from `deploy/` with systemd. The existing finance boot/recovery services restore containers after reboot. These jobs do not restart Minecraft, WireGuard or other unrelated services. Useful checks:

```
systemctl list-timers 'finance-*'
journalctl -u finance-classify.service -u finance-report-prepare.service -u finance-report-send.service
```

## Evaluation

`operations.py evaluate --start 2026-11-09 --end 2026-11-16` predicts on posted expenses from that local-date week, using only earlier eligible purchases. It removes all test category/payee/rule inputs from prediction and excludes labels corrected after the cutoff. Predictions are saved before joining reference labels. It also evaluates with all matching test merchants removed from training. Current user overrides are disabled.

The export contains merchant, date, amount, bank MCC, saved target label, prediction, method, score, automatic eligibility, reason, unseen-merchant prediction and transaction ID. Saved labels are reference labels, not independently verified truth. Repeated merchant purchases and a small test sample limit the conclusions. Accuracy, abstention rate and automatic-match precision must all be considered. A low overall result is a reason to retain manual review, not loosen the threshold or train on held-out answers.

Run synthetic tests with `python3 -m unittest -v test_classifier` from `deploy/local-finance`. They cover label isolation, temporal holdout, MCC handling, correction precedence, mixed-purpose merchants, word boundaries, transfer filtering, local dates/DST and mail deduplication. The MCC TypeScript unit tests cover code validation. No outage or Pi reboot is required to verify the timers.
