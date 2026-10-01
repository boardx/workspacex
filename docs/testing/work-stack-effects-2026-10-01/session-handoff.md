# Current handoff

Sole delivery PR: #4867, branch worker/codex-workstack-effect-fixes. All six previous PR scopes plus chat import scope and PDF missing-native-runtime diagnosis are consolidated. The source PRs #4866/#4872/#4875/#4876/#4879 are closed as superseded.

Current results and exact logs: UNIFIED-DELIVERY.md. Stable API 122 tests, admin/home 82, chat scope/capability 46 (helper overlap), PDF 15, Python 12 and deployment 38 pass. Normal pre-push passed on 5cd5d96ab; unified-head CI is still pending. C04 stale eval evidence and B14 empty-thread extraction are repaired under the same PR; integrated continued-fix database tests passed 134/134 and single-source/schema checks 11/11. Latest-head CI and normal push checks remain required.

S003 1.0.1 strict machine schema and G0–G5 pass deterministically. Old packs and role pins remain fixed; historical 1.0.0 reports do not prove current schema conformance or real model quality.

Backlog completion is evidence-based. B08/B09/B10–B13 deployment/real-model/browser acceptance and C01–C03 wider coverage remain open. Testing-session dispatch is BLOCKED_NOT_DISPATCHED: no cross-chat sending tool or local inbox access. Use synthetic data and verify the combined deployment SHA before browser testing; never publish private thread targets.

pnpm9 uses /tmp/workstack-bin/pnpm and COREPACK_HOME=/tmp/workstack-corepack. External dependencies are shared, but workspace package links must point into this worktree (old-main contracts otherwise invalidate tests). Isolated test stacks are cleaned by with-test-isolation.
