# Six temporarily deferred Board acceptance cases

Explicit user approval: 2026-10-06 03:53 UTC, only these six acceptance cases. Test bodies remain intact; entire suite, product code, safety and permissions checks remain enabled.

Failure evidence: run 37407506207/job 112088393761 (161 passed, 6 failed, 1 skipped), and historical run 37369054478/job 111961295533. Missing board-bulk-text after Shift+N; DOM focus cause remains unproven.

- `apps/web/e2e/board-selection-layout.spec.ts`: 15 layout commands converge and undo
- `apps/web/e2e/board-selection-layout.spec.ts`: Alt-drag duplicates ActiveSelection, converges and undoes
- `apps/web/e2e/board-selection-layout.spec.ts`: pointer snap guide converges and undoes
- `apps/web/e2e/board-selection-layout.spec.ts`: smart preview cancel apply undo CAS and reload
- `apps/web/e2e/board-selection-layout.spec.ts`: visual acceptance: compact selection in three viewports
- `apps/web/e2e/board-thinking-input.spec.ts`: brainstorm input creates twenty connected ideas and one-operation bulk undo

Restore before claiming these behaviors accepted: reproduce the shortcut/focus failure, fix the established cause, remove exactly these six skip calls, run all six with original assertions (including toolbar geometry, selection handles, peer convergence, undo, CAS and reload), and preserve actual CI evidence. Owner: existing Board owner, coordinated by main coordinator. No completion date or passing claim is implied. Expected unchanged-suite result is 161 passed / 0 failed / 7 skipped, subject to actual CI.
