# Independent task and whole-branch review — #6222

Verdict: **CLEAN**. No actionable P1/P2 findings in the reviewed scope.

Base: `ec1695d8fd646e004ca40dafbfa8e03bf01f20ef`.
Reviewed source: `770c9a835721f2aaa7278303265b91ef32890d2b`.
Read-only Git confirmed HEAD equals that source and no working-copy differences in the five reviewed files. This single bounded review covers both the maintenance task and the entire branch delta; it does not approve future changes.

## Scope and behavior

- Read `review.diff` first, then `plan.md` and `callers.txt`. Branch delta is exactly five files, 97 insertions and 3 deletions: the shared 401/403 split, one resource key per supported locale, focused regression tests, and two stale research-overview expectations.
- `apps/web/lib/http-failure-text.ts:15–20`: 401 retains the original auth key; 403 resolves the new permission key. The 404, 429, >=500 and generic branches, function signature and Chinese default are unchanged.
- `apps/web/lib/i18n/messages/en.ts:246` and `zh-CN.ts:245`: new strings match the approved literal copy. Each locale contains exactly one `common.http.forbidden` definition; no later resource overrides were found. Both supported locales are covered, and existing auth text is unchanged. The English dictionary remains keyed by the Chinese dictionary type; existing resource tests enforce runtime key and interpolation parity.
- Reviewed shared design/home/artifact/workflow/escalation adapters and the supplied caller inventory. Existing known-domain lookups still precede fallback. Direct admin/project/agent consumers inherit only the intended 403 display change; no caller signature changes are required. Research task/interview errors reach this fallback as expected.
- API client, guards, requests, domain maps, retries and authentication behavior are outside the delta and unchanged. `ApiError` retains status, reasonCode, raw, rawBody and message; the helper receives only status/locale and cannot mutate the error object.

## Coverage assessment

The new tests independently pin literal output rather than deriving expectations from the implementation. They cover 403 in English, Chinese and omitted locale; unchanged 401; 404/429/server boundary 500 plus 503/599; and generic 400/418/499. Caller tests exercise unknown and null reason codes through design/home in both locales and artifact in its existing Chinese default, check diagnostic suppression and error preservation, and pin known-domain precedence. Existing artifact tests retain canonical 404/503 domain semantics. The research UI assertions now verify the permission message for two failed actions while retaining no-navigation and surviving-UI checks. This is meaningful coverage for the bounded display-only change.

## Evidence and remaining gates

No tests, type checks, lint, builds or services were run by this reviewer. Root-owned receipts were inspected in `evidence/http-forbidden-copy-6222/`:

- RED: exit 1, 4 failed / 33 passed, 11.155 seconds; failures identify the wrong 403 helper/caller/UI copy.
- GREEN at the reviewed source: exit 0, 37/37 across five files, 11.302 seconds.
- Focused ESLint: exit 0, 3.285 seconds.
- init: exit 0, 16.695 seconds.

These are root-produced curated receipts; raw private logs were not independently inspected. Normal-hook Web/API type/lint checks, tracked scanner, publication, remote CI and merge remain root-owned and unverified by this report. CLEAN is a source-review verdict, not a claim of delivery or full gate completion.
