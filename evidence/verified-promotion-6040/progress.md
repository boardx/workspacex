# Verified promotion progress

Issue #6040 follows the user's explicit approval of develop evidence reuse for pure production synchronization. Both orphan API configs now have named package scripts; reachability checks 62 configs/12 live specs, provider suite 10 tests and self-usage suite 2 tests pass locally.

Existing ci-lane-dedup refuses PR reuse because synthetic merge differs from source SHA. That protection remains. A separate trusted-base promotion admission validates tree identity and both complete develop workflow results, then preserves real required-check success. Missing/unusable evidence blocks an identified pure promotion. Only ordinary changes or policy/tree changes fall back to the original verification.

Implementation and verification are in progress; no reuse or production readiness is claimed yet. Final PR/CI/review evidence is recorded on #6040.

Implementation verification: 25 CI regression files / 219 cases passed; Node policy/lookup counterexamples 24 passed. Config reachability passes for all 62 configs and 12 live specs; named provider/self-usage suites pass 10/2 tests. Required checks now explicitly fail on failed pure-promotion admission instead of silently falling back to partial PR checks. Ordinary changed/policy bootstrap paths retain original verification. A read-only review found and verified the repair of an interleaved rerun race; both workflow snapshots are rechecked at final admission. GitHub exact-head review and live CI remain pending until PR creation.

CI follow-up: the static E2E coverage analyzer conservatively treated the promotion output guard as unknown. It now recognizes only the exact trusted admission wiring for ordinary-event reuse=false; fake outputs, extra steps, wrong checkout, path/manual filters and unknown conditions remain rejected. Local verification: 26 CI regression files / 247 tests; 27 Node promotion tests including merged production push and ambiguous association; actual spec-gate coverage passes. Independent read-only review found no blockers. Remote CI remains required before merge.
