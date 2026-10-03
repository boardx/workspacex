# #5193 latest-main integration verification

Source baseline: `aa861b3f8266004afbd4f17dd5dfc47798be662a`; parent applied historical #5193 product/tests onto latest main, with no runner source edits.

All commands ran in `/Users/shenyangjun/.codex/worktrees/survey-report-echarts` with `PATH=/Users/shenyangjun/.npm-global/bin:$PATH` (pnpm 9). No product or test edits by test runner; no runtime restart/build or DB writes.

| Command | Result | Log |
|---|---|---|
| `pnpm --filter web exec vitest run tests/ui/survey-template-actions.test.tsx` | RED exit 1: 7 failed / 12 passed | actions-red.log |
| `pnpm --filter web exec vitest run tests/ui/survey-live-workspace.test.tsx` | RED exit 1: 2 failed / 33 passed; missing unbind button | workspace-red.log |
| `pnpm --filter web exec vitest run tests/ui/survey-template-actions.test.tsx tests/ui/survey-live-workspace.test.tsx` | GREEN exit 0: 54 passed / 2 files | focused-green.log |
| `pnpm --filter web exec vitest run survey` | GREEN exit 0: 365 passed / 37 files | frontend-green.log |
| `pnpm --filter web typecheck` | exit 0 | typecheck-web.log |
| `pnpm --filter web exec next lint --max-warnings 0 --file components/survey/library/template-actions.tsx --file components/survey/live/survey-workspace.tsx --file components/survey/report/template-editor.tsx --file tests/ui/survey-template-actions.test.tsx --file tests/ui/survey-live-workspace.test.tsx` | exit 0; no warnings/errors | lint-web.log |
| `./init.sh --quick` | exit 0 | init-quick.log |

RED preceded parent product patch. GREEN validates parent-applied product patch atop latest-main branch. API/contracts unchanged; no duplicate API checks. Real browser acceptance remains parent-owned and is not asserted by these tests.
