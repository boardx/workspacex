# Runtime environment parity #5284

Base: latest fetched main `6c251df959d0ab498494ed35e9fde4c34c2b8837`. Issue #5284. Scope: local-runtime parity classification, child environment inheritance and tests only.

Three API reads lacked classification: DESIGN_HTML_PAGES defaults to HTML pages and is default-ok; KG_EVAL_FIXTURE/KG_EVAL_RECALL_MODE are explicit isolated evaluation switches and must not leak from parent environment into local user processes. processes.baseEnv now reads must-stay-unset names from parityIndex, preserving one source of policy and existing broader cloud/DB prefix filtering. Explicit per-child spec.env overrides remain possible for deliberate isolated seed runners.

Original parity RED: 1 failed/4 passed. Actual managed-service and run-to-completion child RED: 3 failed/1 passed, showing inherited KG values; positive explicit override remained valid. After the three omissions were fixed, unchanged stale assertion exposed four dead names: DASHSCOPE_API_KEY and KERNEL_OMNI_REALTIME_API_KEY/BASE_URL/MODEL. `rg` in apps/api/src finds no reads; removed only stale classification entries, no Omni/domain behavior changes.

Commands ran with PATH=/Users/shenyangjun/.npm-global/bin:$PATH (pnpm9.15.0):

- `pnpm --filter @repo/local-runtime exec vitest run test/parity.test.ts`: expected exit1 (parity-red.log).
- `pnpm --filter @repo/local-runtime exec vitest run test/inherited-parity-env.test.ts`: expected exit1 (inherited-red.log).
- `pnpm --filter @repo/local-runtime exec vitest run test/parity.test.ts test/inherited-parity-env.test.ts test/processes.test.ts test/no-egress-endpoints.test.ts`: exit0,16 tests/4 files (focused-green.log).
- `pnpm --filter @repo/local-runtime typecheck`: exit0 (typecheck.log).
- `pnpm --filter @repo/local-runtime lint`: exit0; package script is a placeholder, no static lint coverage claimed (lint.log).
- `./init.sh --quick`: exit0 dependency-health baseline (init-quick.log).
- `pnpm run verify:quick`: exit0 affected typecheck/lint/test with isolated wrapper (verify-quick.log), no timeout increase or skipped gate.

Unknown pnpm-lock.yaml/pnpm-workspace.yaml changes have private patch backups and scoped stashes retained. They were temporarily scoped-stashed during affected verification and reapplied afterwards; excluded from this commit/PR. Parent-owned untracked QA artifacts unchanged. Existing preview25708/API24705/ownedQA DB/providers preserved. No merge/deploy/new worktree/loop.
