# All Skill runtime/eval evidence

Source baseline: `d03fb3b5dacc0d4ff4464dff3af830a9744d2b1c`; this commit adds only the current-execution error fix and DB-free test registration. This directory contains synthetic local evidence; no catalog write-back, publication, or real model quality PASS occurred.

- [x] Run standard all-skills evaluator against an isolated copy of `evals/work-stack` (original fixtures/reports remain untouched).
- [x] Preserve the initial failed batch and environment failures.
- [x] Validate all 27 existing Skill suites with the standard contracts validator: 27 passed.
- [x] Execute deterministic API/runtime regressions: 130 tests across 13 files passed.
- [x] Execute Python package/native Skill context/activity/draft regressions: 32 passed, 6 skipped. Skips require the owned real native sandbox lane and remain unverified.
- [x] Reproduce and fix an evaluator reporting defect: no current report previously returned historical gate state with no execution error. The new failing-current-execution counterproof failed against original source, then passed with the fix. Missing current reports now yield `status:null`, `G5=not_evaluated`, and an explicit execution error, preventing substitution of historical evidence.
- [ ] 26 suites: executable subject registration is missing. The standard evaluator is explicitly loopback-only and registers only S003; no generic fake subject was added.
- [ ] 56 authored Skills: no suite exists. This is a coverage gap, not a passing result.
- [ ] All 83 Skills: real-model quality BLOCKED. The existing native real-model runner was attempted and rejected missing `DASHSCOPE_API_KEY` before any model call. Configuration-presence evidence contains booleans only. Real configured execution also requires `DASHSCOPE_BASE_URL`, `DASHSCOPE_MODEL`, a bound native sandbox, and scenario/evidence settings.

`per-skill-evidence.json` lists every one of the 83 authored runtime stable IDs. Exactly S003 produced a fresh deterministic report: 10/10 subject cases, 2/10 hard-coded generic baseline cases. This is protocol/grader evidence and does **not** establish model quality. The original batch reported G5 pass 1/errors 0 despite 82 invocations producing no report. The fixed batch reports G5 pass 1/errors 82, preserving all missing-suite/unregistered-subject failures rather than promoting them.

## Commands and results

Run from the repository root unless noted:

1. `node --import tsx apps/api/scripts/work-eval.ts --all-skills --baseline --evals-root /tmp/skills-all-evals-runtime` → nonzero, 83 rows, 1 deterministic S003 pass, 82 not evaluated/errors after fix. `batch-before-fix.json`, `batch-after-fix.json`, `batch-worktree-import.log`, `batch-fixed.log` retain both states.
2. For each of the 27 directories: `node --import tsx packages/contracts/scripts/validate-work-eval-suite.ts evals/work-stack/S###` → 27/27 exit 0; exact commands/results in `suite-validation.json`.
3. From `apps/api`: `vitest run` the eight files listed in `api-local-ipc.log` → 91 passed. `vitest run` the five files listed in `api-extra-local-ipc.log` → 39 passed. `batch-error-red.log` records the unchanged-source counterproof failure. Local IPC/socket permission was needed for tests spawning tsx and real loopback HTTP servers; default-sandbox EPERM logs remain preserved as environment failures, not product failures.
4. From `apps/deep-agent-service`: `PYTHONPATH=src /tmp/role-acceptance-venv/bin/python -m pytest tests/test_skill_packages.py tests/test_native_skill_activity.py tests/test_native_skill_execute_activity.py tests/test_standard_skill_draft.py tests/test_role_model_context.py -q` → 32 passed/6 skipped, `python-original.log`.
5. Existing real runner: `PYTHONPATH=src /tmp/role-acceptance-venv/bin/python tests/skill_batch_real_model_runner.py` with a synthetic configuration-preflight payload → exit 1, `missing DASHSCOPE_API_KEY`, `real-model-preflight.log`. No credentials were synthesized.
6. `node --import tsx apps/api/scripts/lint-work-skill-manifests.ts` → exit 0, `manifest-validation.log`.
7. `node .harness/scripts/lint-arch-deps.mjs apps/api/src` and `git diff --check` → exit 0.

The initial worktree dependency resolver pointed at a different checkout and lacked its new contracts export; it was corrected locally without source changes. Those setup failures are preserved in `api-original.log`/`api-worktree-import.log`. `tsx` CLI IPC was bypassed for the batch using standard `node --import tsx`; the runner's semantic failures remain.

The DB-backed batch catalog/write-back, frozen claim/acceptance, live import, and owned-container lane have not been rerun here. PostgreSQL tests require the parent-owned isolated database; no services were started. No whole-repository typecheck or build is claimed by this report. The 26 execution adapters, 56 missing suites and real-model scenarios are still open work, not completed acceptance.

## 汇总边界补充

当前整合口径为136项确定性边界回归，仅对应其源码/权限/编排保护；上面的130项是历史运行批次，不是Skill通过计数。全200库存实际 `--check` exit0，聚合0 PASS/56 FAIL/27 BLOCKED/117 NOT_IMPLEMENTED；83 packaged、27 suites、1 subject。不据测试数覆盖这200项，也不据S003回环宣布专业质量通过。26 subject入口、56 suite、56 schema和117实现缺口仍open。#16生产浏览器本轮结果尚未知，此处不预写PASS。
