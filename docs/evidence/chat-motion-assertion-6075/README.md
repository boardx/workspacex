# Streaming motion assertion — issue6075

Source incident: queue run41243055963, candidate37272058b8f7cf76dadc498851767aa6c258b49a, Chat shard1. Exact assertion expected animationName none but received empty;12 tests passed,52 not run, one interrupted. These incomplete cases are not passing evidence.

Change replaces a one-shot element evaluation with the Playwright locator's retrying toHaveCSS(animation-name,none). Streaming may replace the SVG between visibility and style reads. The exact no-animation requirement and all remaining run/trace assertions are retained.

Real Chromium controlled reproduction: connected SVG animationName is none, removed SVG returns empty. Replacing the element then using the locator assertion passes; a genuine CSS animation is still rejected. Independent read-only review ACCEPT. Failure trace downloaded and original assertion inspected; controlled reproduction is not proof of the exact DOM removal timing in that historical trace.

Validation order: run the original failed case first, then its affected Chat shard. No claim to reuse old-SHA checks as new-SHA passes, or to mark cancelled/unrun tests successful. Full acceptance still follows repository gates.

Focused real-stack result: `pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter web exec playwright test agent-workbench-ui-refinement.spec.ts --config playwright.chat-read.config.ts --project=chat-read --grep 'real streaming chat' --max-failures=1` passed1/1, case27.5s, wall3m4s including environment compilation and cleanup. Its owned compose stack was verified removed. Chat shard1/2 is running separately; no full-suite claim yet.
