# CI throughput worker

Branch worker/i18n-ci-safe-display, shared root checkout explicitly assigned exclusively to this worker; no second worktree. Issue6180. Files: targeted UI planner/policy, runner browser config binding and tests. Product/domain workers do not edit these.

Scope verification: evidence/ci-display-speed-6180 contains19-test output, browser discovery, immutable historical diff trials and timing steps. The selected real-browser fixture proves plan config overrides caller options; replayed run/attempt, missing/skipped coverage and forged hash fail.

Not yet a general migration speedup: multi-module PRs6175/6177 and unpublished6178 stay full. Need normal push/static gate, independent review and CI; no success claim for unrun checks. After first PR, measure same-candidate production builds and test distribution, keep different SHA/attempt acceptance isolated. Do not modify active queue/ruleset or treat skip as PASS.
