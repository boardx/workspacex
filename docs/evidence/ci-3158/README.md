# Versioned merge checks (#3158)

Policy authority is `.harness/config/ci-check-policy.json`. `backend-required` waits for all non-browser backend gates (including the matrix job's combined result). The PR classifier uses the same required-check list. Existing browser release gates remain outside the merge requirement.

Live `pr-queue` loads the remote main SHA and reads its policy, rather than applying a worker checkout's future policy. Historical doctor reads the merge commit's first-parent policy. A verified, complete history with no policy ever present uses the frozen legacy contract; unreadable, malformed, deleted policy or incomplete history fails closed. The policy introduction PR is one commit. Versioned history requires main PR rules to allow merge/squash and disallow bypass, established before publishing the policy PR; multi-commit rebase has no unambiguous first-parent merge boundary.

Rollout is two-stage: bootstrap enables existing required checks, mandatory PRs, merge/squash, no bypass; after the new aggregate is on main, final rules add merge-gate and backend-required. Both plans derive from the same policy and the verified existing ruleset, preserving deletion/force-push protection. The renderer never writes to GitHub. Ruleset activation/readback and CI evidence are recorded in the issue/PR. Existing merge rules or bypass actors require explicit reconciliation rather than being silently overwritten.

Verification: initial failing policy test captured before implementation. Targeted legacy/modern/doctor tests passed; real closed issue #3147 / PR #3148 resolves policy v1 and remains green. Independent review found and corrected policy-deletion fallback and required unambiguous merge methods plus full-history proof. See accompanying logs and rendered plans. Full harness/real CI completion is recorded as it occurs; no new policy is considered live merely because this file exists on a branch.

GitHub reference: https://docs.github.com/en/rest/repos/rules and https://docs.github.com/en/pull-requests/reference/pull-request-merges

Bootstrap applied and read back on 2026-09-08 UTC: active, three existing Actions checks, required PR, merge/squash, no bypass. GitHub added its default extra approval for unattributed changes. Disabling that extra requirement was rejected by automatic approval review; it remains enabled and the final plan preserves it while the user decision is pending. Full harness: 86 files / 989 tests passed; final policy/classifier regression: 3 files / 71 tests passed.
