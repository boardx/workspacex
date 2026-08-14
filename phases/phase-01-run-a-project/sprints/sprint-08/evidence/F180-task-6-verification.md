# F180 Task 6 verification record — 2026-08-14

## RED → GREEN

- RED: `pnpm --filter web exec vitest run tests/ui/guided-research-visual-contract.test.tsx` failed after adding the
  workspace contract: the nearest layout only exposed `data-layout="signed-desktop"`, not
  `data-layout="skill-workspace"`.
- GREEN: after adding only `data-layout="skill-workspace"` to the step-layout root and
  `data-testid="research-step-main"` to its main element, the same test passed: 6/6.
- RED: the completed research card test expected `查看报告` and received `查看研究`.
- GREEN: after changing only the completed-card copy, the combined flow/rewrite test passed: 14/14.

## Committed harness rerun

`F180.verify.log` is the committed raw output from the latest `pnpm harness verify --sprint 01/08` run. Earlier
standalone commands were diagnostic runs only; their raw output is not used to assert the final harness result.

| Command | Result | Evidence |
| --- | --- | --- |
| `pnpm --filter @repo/contracts exec vitest run tests/guided-research-session-contract.test.ts` | PASS | 6 tests |
| `pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter api exec vitest run tests/research/guided-session-list-and-recovery.test.ts` | PASS | Exit 0; 7 tests; admission wait 0s; peak isolated DB connections 4. |
| `pnpm --filter web exec vitest run tests/guided-research-stage.test.ts tests/guided-research-demo-state.test.ts tests/guided-research-skill-state.test.ts` | PASS | 13 tests |
| `pnpm --filter web exec vitest run --pool=forks --maxWorkers=1 --minWorkers=1 tests/ui/guided-research-skill-assistant.test.tsx tests/ui/guided-research-visual-contract.test.tsx tests/ui/guided-research-flow.test.tsx tests/ui/guided-research-home-live.test.tsx tests/ui/guided-research-checkpoints-live.test.tsx` | PASS | Exit 0; 34 tests |
| `pnpm --filter web exec vitest run tests/research-rewrite.test.ts` | PASS | 1 test (also included in the 14-test RED/GREEN follow-up) |
| `pnpm --filter api run typecheck` | FAIL | Exit 2; `packages/fabric-markdown` lacks DOM types. The remaining commands were not reached in this harness rerun. |

## Browser path and screenshots

- At 1280×900, the `http://127.0.0.1:3010/research` instance rendered an older Studio submenu, so it was not used
  as F180 acceptance evidence.
- The task handoff's assigned stack `http://127.0.0.1:3074/research` redirected the unauthenticated browser to
  `/login`. No credentials or supported local test-login flow were available, so the requested create → Skill
  apply/undo → sequential confirmation → refresh → demo completion journey could not be safely performed.
- Consequently, no new live journey screenshot is claimed. Existing six-screen comparison captures and the create
  dialog capture remain under `evidence/design-qa/`; this record deliberately does not present them as a replacement
  for the blocked authenticated path.

## Scope and self-check

- Authoritative F180 requirement was updated with R11; no human design-signoff status was changed.
- R11 explicitly aggregates R9 visual/entry and R10 creation-metadata constraints, so the supported single
  `spec_ref` anchor remains `#R11`; the reviewer-proposed `#R9-R11` is incompatible with the current parser.
- `active-features.json` and `.harness/state/PROGRESS.md` were regenerated only by `pnpm harness claim`.
- No real Web Search or model call was made. Demo labels are asserted in the visual contract.
- The combined UI suite is intentionally serialized as one fork worker because its five component files mock the
  same API module. The updated harness command passed 34/34 tests, including all three checkpoint cases; its exact
  command and output are in the refreshed `F180.verify.log`.
- The refreshed `pnpm harness verify --sprint 01/08` left F180 as `in_progress` only because the later API
  typecheck exited 2 on unrelated `packages/fabric-markdown` DOM type errors (`Element`, `SVGElement`, and Canvas
  rendering methods are absent from its TypeScript environment). No F180 code changes are made for that baseline
  concern.
- `pnpm harness doctor --phase 01` was invoked after harness verification; it completed without changing F180 or
  the generated evidence/state fields in this worktree.
- Remaining gates: unrelated API typecheck baseline failure and authenticated two-width browser journey unavailable.
