# Final real browser CI evidence

PR #6017 head f15db60418e173db12eda079d1a5f1dc3a0d037d. Job billing-cashier-glue completed SUCCESS.

Source: https://github.com/boardx/workspacex/actions/runs/40999723654/job/123881039740

The dedicated lane runs real Next, Billing/usage API, PostgreSQL and signed loopback merchant/provider fixtures; it is not production charging certification.

```text
billing-cashier-glue	Real Next / Billing API / PostgreSQL / signed merchant and callback	2026-10-30T03:56:03.5515809Z  ✓ tests/billing/cashier-browser.integration.ts (7 tests) 112314ms
billing-cashier-glue	Real Next / Billing API / PostgreSQL / signed merchant and callback	2026-10-30T03:56:40.3285322Z  Test Files  2 passed (2)
billing-cashier-glue	Real Next / Billing API / PostgreSQL / signed merchant and callback	2026-10-30T03:56:40.3291863Z       Tests  8 passed (8)
```

The redundant local rerun waited for another session's heavy E2E lock, then was deliberately interrupted (exit130) after this exact-head CI lane passed. It is not counted as a test pass. Its owned process group and isolated container project were checked empty before releasing only its own quarantined port markers; no other session's lock/process was touched.
