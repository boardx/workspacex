# Request admission and cumulative settlement — #5997

The user approved the design and inline execution. Final integration target is develop; Task 1 dependency is PR #5998. This delivery changes personal admission to a normalized balance >= 0, admits enterprise debt, and never interrupts an already admitted request because its wallet turns negative.

## Verification

| Evidence | Actual result |
| --- | --- |
| red-admission.md | New policy RED 6/6 against the old global preflight/maximum-hold rule |
| red-stream.md | Cumulative snapshots/recovery RED 3/3 against terminal-only settlement |
| red-policy-ui.md | New policy explanation RED 1; old UI tests 14 passed |
| billing-regression.md | Complete billing directory: 37 files / 298 tests passed, isolation wrapper exit 0 |
| provider-integration.md | Actual HTTP/VLM/private accounting plus stream and admission: 19/19 passed |
| policy-ui.md | Fixed-policy UI and guidance regressions: 15/15 passed |
| api-typecheck.md, api-lint.md | API typecheck and full lint exited 0 |
| web-typecheck.md, web-lint.md | Web typecheck and full lint exited 0 |
| migration-scope.md | Both scope guard cases pass, including unknown/missing/duplicate migration refusal |

The first complete billing run had 294 pass / 3 fail: old tests asserted that enterprise zero balance must prevent a dispatch. Those assertions were updated to the newly approved policy while retaining real dispatch counters, receipt replay, exact debit and typed failures. A new actual HTTP test proves negative personal balance prevents transport, zero admits one completed request, and the resulting debt prevents the next transport.

Interim `billingReceipt` snapshots are cumulative authoritative usage, not estimated text/audio chunks. Each immutable receipt is tenant/request-bound; only the difference between cumulative rounded cost and previous debit is charged. A final receipt releases the original hold. Only terminal totals enter the existing sole token-event writer, preserving quota/chart counts. Legacy terminal-only providers retain their receipt behavior.

The legacy preflight flag remains persisted/audited for compatibility, but cannot override the fixed business policy. New API responses expose the fixed policy and the platform UI does not offer the legacy bypass switch. Original content-ACL lint guards remain; the extracted financial receipt reader is narrowly declared with provenance checks and verified RLS/composite foreign-key isolation.

No real external merchant charge, production deployment, old-user migration, or phase passing claim. Test isolation scopes were released by the wrappers.
