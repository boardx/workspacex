# Session handoff — #6322

## Currently verified

The committed evidence document `docs/testing/cn-chat-command-outcomes-6322.md` exists in the git tree at fd4ac6fccda077e9820a9da498b0f74a4267f782. It records the red/green cases and explicit limits. Sandbox17, isolated API20, Python58 passed; one existing E003 owned-container case skipped. API/sandbox typecheck, API lint and affected pre-push passed. Exact-head independent review found no actionable findings.

## Changes

Session Bash pipefail plus image dependency/probe; structured execute exit outcome in the API; advisory no-install/no-network and publication guidance in native graph construction. Each other CN fix has its own issue and PR (#6324, #6326, #6328, #6329); this PR is #6331 and closes #6322 only.

## Remaining or unverified

CI and verify:quick were pending when this snapshot was committed. Prompt injection tests do not prove real-model obedience. Linux isolation must be checked through the native CI lanes. Nothing here proves CN production is repaired. The successful original meeting output, failed PDF attempt and successful PDF recovery remain distinct evidence, not outcomes inferred from local fixtures. The main checkout belongs to another active task and was left untouched. Coordination identity authentication was skipped by explicit user instruction.

## Next action

1. Fetch current refs, then run `pnpm harness pr-queue --pr 6331 --json`; use the returned head SHA and current check state as authority. Repeat for #6324, #6326, #6328 and #6329 before integration.
2. Fix any red check on its own issue branch. Do not treat skipped/deferred lanes as passes or bypass the canonical classifier.
3. The queue currently reports merge authorization false. Hand the concrete green PRs to the authorized integration/release lane; do not self-merge or mutate production to bypass that boundary.
4. After authorized CN release, repeat the original browser cases, including actual visible image dimensions and refresh, approval/truncation announcements and prohibited-command behavior. Record the release SHA and new evidence before asserting CN repair.
5. Let test-isolation release its owned compose stacks and verify no owned resources remain. Archive the native managed worktree only after active verification and CI repairs finish; do not remove the unrelated main checkout.
