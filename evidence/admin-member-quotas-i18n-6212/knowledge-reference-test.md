# Knowledge reference test: admin member quotas (#6212)

## Outcome

**PASS** — `mod-org-identity/SKILL.md` gave useful, authoritative entry points for this task: the quota repository and F159 usage ledger for accounting, and `design-failure.ts` → `http-failure-text.ts` for user-facing errors. The two named UI tests identify the locale boundary. This is a reference/application result; no dynamic tests were run.

## Quota and usage accounting

Keep the UI copy that a failed call counts as a call but does not necessarily count as tokens. Do not alter backend accounting to force failed calls to zero tokens or reinterpret `failedCallCount` as token usage.

The authoritative aggregation is `apps/api/src/infrastructure/auth/pg-token-quota-repository.ts`: `readUsage` separately counts all rows as `callCount`, failed rows as `failedCallCount`, and sums `tokens_total` as `totalTokens`. The same repository's monthly member/org usage sums `tokens_total` without filtering successful outcomes. F159's write contract and migration define the recorded usage facts; a failure may carry provider-reported token usage.

For a valid report with `callCount: 1`, `failedCallCount: 1`, and `totalTokens: 23`, show one call, one failed call, and 23 tokens. The failure counter describes outcome; token total describes measured/reported token quantity. They are independent dimensions, so the failed call is not automatically a zero-token call.

## Error wording and locale

Use `apps/web/lib/design-failure.ts`'s `describeFailure(err, locale)` for retained semantic callbacks; it maps known reason codes and delegates generic HTTP status wording to `apps/web/lib/http-failure-text.ts`. For an API error, pass the current rendered locale to `describeFailure`. Keep the callback's raw error/payload and translate at render time; locale belongs in the render-time call, not the request/read effect dependencies. A locale switch then changes wording without issuing another request.

Suitable failed-call copy:

- English: “Failed calls count toward the call total; tokens are counted only when usage is reported.”
- Chinese: “失败调用计入调用次数；仅在有用量报告时计入 Token。”

## Existing tests locating this boundary

- `apps/web/tests/ui/admin-member-quotas-i18n.test.tsx`
- `apps/web/tests/ui/ai-usage-i18n.test.tsx`

These are the named regression-test locations for admin quota and AI usage locale behavior. They were not executed for this reference test.
