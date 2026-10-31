# CI cleanup rollout status

Issue: #6052. User approved a staged lifecycle cleanup on 2026-10-31.

## Implemented source changes (awaiting PR acceptance)
- Board manual-only jobs move to `board-manual-acceptance.yml`; automatic Board commands remain.
- Full regression/base/manual jobs move to `harness-acceptance.yml` (develop push + explicit manual inputs). `harness-verify` retains PR/merge-group checks and transitional push validation.
- Automatic versus acceptance compile/smoke steps retain mechanical equality assertions. PR executes them in automatic workflow; develop push executes them in acceptance workflow, not both.
- Backend API static validation delegates to compile producer for PR/merge-group/push; standalone manual backend validation remains.
- Optional Skill test retains all app/package/script/harness/skill/agent/patch and dependency inputs while skipping unrelated documentation changes. Conditional coverage is explicit, not a claim of unconditional E2E.
- Image build is parallel with admission, but Devapp activation requires current successful exact-source validation from both automatic and full acceptance workflows plus backend fast/runtime/core-loop. Old duplicate read-only backend admission is removed.
- Existing-tag manual Devapp activation fails closed until a trusted tag-to-source manifest is supplied; current-branch checks never authorize an older tag. New-source develop builds remain allowed. CN/US existing immutable-tag promotion and production approval behavior are unchanged.

## Not activated yet
Merge queue rule is not enabled by this source PR. Existing five required check names and push fallback remain. Activating a queue before merged trusted workflow wiring and a successful queue-candidate test would risk blocking every PR or losing coverage.

After this PR is green and merged:
1. Freeze current develop and verify all required check producers execute on merge_group; test missing/failed/cancelled candidates.
2. Enable require-merge-queue using current ruleset identity, preserving required checks, PR review-thread policy and bypass settings. Confirm a real candidate completes before claiming active.
3. In a separate reviewed cutover, remove equivalent develop-push source tests and retarget admission to verifiable queue-source evidence. Never borrow a PR-head success for a different integration tree.
4. Scope independent heavy Board batches after preserving their measurement/provenance protocol. No schedule added and no historical evidence deleted.

## Acceptance boundaries
This is source/policy verification. It does not prove a real queue, actual rollout/recovery, or production business transactions. Keep result snapshots and PR run URLs rather than recording pending as success.

## 2026-10-31 stage2 observation

#6053 merged; develop-only queue ruleset26262460 activated with original protections unchanged. Real #6056 candidate30bac748397349ae308a81cc2297cad78f91f9da passed all five required checks before merging as that exact SHA. Stage3 source-event and post-merge dedup cutover remains under #6057; see 2026-10-31-ci-postmerge-dedup.md. These observations do not replace live API checks.
