# Interview report pruning — #5516

User-reported failure: the report stream produced Markdown but ended with `REPORT_GROUNDING_REJECTED`. Existing generation performs at most two provider calls (one for an existing failed candidate), then rejects the entire candidate if any citation/claim still fails.

After the bounded repair, remove complete unsupported Markdown blocks and run the unchanged whole-report analysis, claim-boundary and exact evidence checks. Save only a qualifying result with actor/source/version CAS. Retain rejected versions and simulated evidence mode. Never delete only a citation while retaining its unsupported claim. No third model call. If no usable report remains, do not fabricate conclusions or mark it successful. List items are pruned individually; tables/quotes are currently pruned as entire top-level blocks; this favors safe attribution over maximal retention.

Validation (2026-10-09):
- Interview Markdown unit lane: 421 tests across six files passed.
- Real isolated PostgreSQL report recovery: 11 tests passed. Controlled provider always emits a valid report plus a nonexistent answer citation. Two failed versions remain in history, the third version contains only valid content and two bound locators. Re-read/reuse adds no model calls or versions.
- API TypeScript, API lint and git diff checks passed.
- Independent review accepted the implementation. CI completion tracked in PR.

Model port in these tests is a controlled double. PostgreSQL, stored Markdown/hash/reference versions, actor authorization and CAS are real. No claim of deployed devapp verification or external-model timing improvement. Print/export validation waived by the user.
