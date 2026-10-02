# Sequential drag acknowledgment boundary

Source: 4567aed0e6799017f33dd7845922362c4973674e.
CI artifacts for #5107 and #5088 showed Panel parentId empty and final geometry error80 (original max32). Local baseline Panel diagnostic1 and ordinary5 passed, so intermittent root cause remains unproven.
Four added lines require existing expectBoardSynced before a real drag and after unchanged parentId/geometry assertions. No mouse events or tolerances changed. Exact SHA independent review ACCEPT; ESLint/diff check passed.
Validation (diagnostics disabled): pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter web exec playwright test --config e2e/board-journey-acceptance.config.ts --grep 'Panel:|Diagram:' --repeat-each=3
Result: 6 passed, exit0; isolated cleanup1s. Log /tmp/pr-panel-ack-validation.log. This is local validation, not CI green or proof of the intermittent root cause.
