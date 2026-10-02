# Chat canvas template source readiness — #5131

CI for Word PR #5127 at `b3a9d66ed22e9222bffdbfe404c0b6b5faa3c926` observed `data-template-source=null` where the test expected `builtin`:
https://github.com/boardx/workspacex/actions/runs/37031932958/job/110920643872

The canvas wrapper exists during validation; organization template resolution completes asynchronously. Waiting for element presence alone does not establish source readiness. This change waits for the exact final source attribute in six assertions. A controlled unresolved template request proves the helper remains pending until resolution. Runtime code and expected source values are unchanged.

Validation on main base `92ce74c1b7ee0cba1887ae92e8aa99bb6622c0d0`:
- Original test baseline: 15/15 passed locally; the CI race was not naturally reproduced locally.
- Controlled regression with immediate source assertion: 1 failed / 15 passed, exit 1 (`settled` was true before request resolution).
- Corrected helper: 16/16 passed, exit 0.
- Independent review: 16/16, `tsc --noEmit --incremental false` exit 0; no blocking findings.
- `./init.sh --quick`: exit 0; explicitly skips full repository validation.

This verifies dispatch, lookup readiness and source attributes in jsdom. Canvas pixels require separate browser coverage. Raw local logs remain in the private acceptance evidence directory; no database or credential dump is included.
