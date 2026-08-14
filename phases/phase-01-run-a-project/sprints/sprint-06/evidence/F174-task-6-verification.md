# F174 Task 6 verification record — 2026-08-14

## RED → GREEN

- RED: `pnpm --filter web exec vitest run tests/ui/guided-research-visual-contract.test.tsx` failed after adding the
  workspace contract: the nearest layout only exposed `data-layout="signed-desktop"`, not
  `data-layout="skill-workspace"`.
- GREEN: after adding only `data-layout="skill-workspace"` to the step-layout root and
  `data-testid="research-step-main"` to its main element, the same test passed: 6/6.
- RED: the completed research card test expected `查看报告` and received `查看研究`.
- GREEN: after changing only the completed-card copy, the combined flow/rewrite test passed: 14/14.

## Automated commands

| Command | Result | Evidence |
| --- | --- | --- |
| `pnpm --filter @repo/contracts exec vitest run tests/guided-research-session-contract.test.ts` | PASS | 6 tests |
| `pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter api exec vitest run tests/research/guided-session-list-and-recovery.test.ts` | PASS | Harness reran it through isolation after 20s admission wait: 7 tests pass; peak isolated DB connections 4. Full output is in `F174.verify.log`. |
| `pnpm --filter web exec vitest run tests/guided-research-stage.test.ts tests/guided-research-demo-state.test.ts tests/guided-research-skill-state.test.ts` | PASS | 13 tests |
| `pnpm --filter web exec vitest run tests/ui/guided-research-skill-assistant.test.tsx tests/ui/guided-research-visual-contract.test.tsx tests/ui/guided-research-flow.test.tsx tests/ui/guided-research-home-live.test.tsx tests/ui/guided-research-checkpoints-live.test.tsx` | PASS | 34 tests |
| `pnpm --filter web exec vitest run tests/research-rewrite.test.ts` | PASS | 1 test (also included in the 14-test RED/GREEN follow-up) |
| `pnpm --filter api run typecheck` | PASS | `tsc --noEmit` exit 0 |
| `pnpm --filter web run typecheck` | PASS | `tsc --noEmit` exit 0 |
| `node apps/api/scripts/lint-permission-paths.mjs` | PASS | 880 files scanned; 130 tenant tables use guarded reads. |
| `node .harness/scripts/lint-arch-deps.mjs` | PASS | 878 files, all dependencies point inward |
| `node .harness/scripts/lint-ui-material.mjs` | PASS | 18 contract bundles, 732 screenshots, no dead or orphaned assets |
| `cd apps/web && ./scripts/lint-design.sh` | PASS | All scanned app/components/lib files pass after the authorized disabled-token correction. |

## Browser path and screenshots

- At 1280×900, the `http://127.0.0.1:3010/research` instance rendered an older Studio submenu, so it was not used
  as F174 acceptance evidence.
- The task handoff's assigned stack `http://127.0.0.1:3074/research` redirected the unauthenticated browser to
  `/login`. No credentials or supported local test-login flow were available, so the requested create → Skill
  apply/undo → sequential confirmation → refresh → demo completion journey could not be safely performed.
- Consequently, no new live journey screenshot is claimed. Existing six-screen comparison captures and the create
  dialog capture remain under `evidence/design-qa/`; this record deliberately does not present them as a replacement
  for the blocked authenticated path.

## Scope and self-check

- Authoritative F174 requirement was updated with R11; no human design-signoff status was changed.
- `active-features.json` and `.harness/state/PROGRESS.md` were regenerated only by `pnpm harness claim`.
- No real Web Search or model call was made. Demo labels are asserted in the visual contract.
- `pnpm harness verify --sprint 01/06` was run after this evidence was created. It left F174 as `in_progress` and
  wrote `F174.verify.log`: contracts, isolated API, and state suites passed, then the 5-file UI batch failed 2/34
  checkpoint tests (`候选方向` / `方向` not rendered within the default query timeout). The same checkpoint file
  immediately passed alone (3/3), so this is a timing-sensitive batch concern, not treated as a passing full gate.
- `pnpm harness doctor --phase 01` was invoked after harness verification; it completed without changing F174 or
  the generated evidence/state fields in this worktree.
- Remaining gates: the timing-sensitive full UI batch and authenticated two-width browser journey unavailable.
