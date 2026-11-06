# Issue #6316 progress

2026-11-06: implemented email-based ordinary organization invitations without peer approval, authenticated existing-account joins for both invitation kinds, enterprise member default 1000 Credit/month with admin overrides and actual usage/hold enforcement, and removed overview live-data badges. Reused current worktree; latest origin/main and origin/develop fetched, develop baseline33f3bd031. User explicitly authorized skipping COORD_GATEWAY_URL.

Verification: init passed, API14 files119 tests, Web15 files115 tests, Python13 tests, both typechecks and both package lint commands passed. Earlier reused fixture database produced stale-credential failures; clean isolated database run passed. First parallel initialization timed out under load; final checks serial. No feature-list status modified.

Independent reviews found and resolved enterprise unbounded request admission regression, lost quota guidance, and incorrect revoke failure copy. Final staged review found no actionable defects.

Boundary: unknown-cost provider calls reserve the member's remaining allowance and stop after confirmed usage exhausts the cap; a provider can incur additional cost between usage receipts. Costs remain truthful. No wallet funds are issued. Existing explicit member overrides survive monthly resets. Existing active shared links retain their stored role; newly created/reissued invitations grant ordinary consultant membership.

Production inbox delivery and production rollout have not been performed in this session. Mail tests exercise the real service through a fake transactional egress. The deployment must have its canonical mail configuration already available; failure is visible and retriable.

Affected static preflight:27/27 tasks passed serially before publication (affected-static.txt).

CI iteration: PR https://github.com/boardx/workspacex/pull/6325 first head c4e79a1 failed forced migration replay, permission exception-count128 cap, stale removed-review wiring, and recovery reviewed-migration suffix. Fixed each cause without relaxing gates: idempotent DDL/policy, reused invitation repository mail store (no new exemption), retired wiring declarations, exact reviewed migration registration. Auth+permission38, forced replay2, migration-scope2, recovery wrapper9 tests passed; API typecheck/lint and UI wiring passed. Scoped independent re-review of mail extraction and migration fixes clean. New head CI pending; PR is authoritative live status.
