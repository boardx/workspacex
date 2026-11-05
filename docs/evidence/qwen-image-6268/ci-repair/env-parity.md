# Queue environment parity correction

Queue candidate 40f1357 failed local-runtime parity because API reads of
BILLING_TARIFF_DB_USER and BILLING_TARIFF_DB_PASSWORD had no local/cloud disposition.
The same failure reproduced on PR #6297 merged with develop 182bbdfe8.

Both names are now classified cloud-only: tariff activation uses a separately
provisioned PostgreSQL writer role, while local PGlite has no such credentials.
The existing writer configuration returns no writer when both values are absent.
No default credentials or local write privilege are introduced.

Validation on this merged candidate:

- Original parity suite reproduced the missing-name failure before the change.
- Parity suite after the change: 5/5 passed in 2.57s (`env-parity.log`).
- Complete local-runtime package: 43 files, 255/255 tests passed in 183.39s.
- `git diff --check`: passed.

This corrects configuration classification only; queue admission and required
checks remain enforced. No existing failure is suppressed.
