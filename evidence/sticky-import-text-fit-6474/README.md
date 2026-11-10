# Imported sticky text fit — #6474

The isolated real browser test inserts a six-section organization template with six long Chinese notes per section into a project Board, verifies source text and geometry, opens the Board, reloads, and checks canonical equality. The source preview and Board-after-reload screenshots were visually inspected: all 36 notes show the complete paragraph, including its final clause. The test fixture uses pink notes; color does not affect fitting.

Command: `pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter web exec playwright test chat-board-target-placement.spec.ts --config=playwright.fullstack-smoke.config.ts --project=seeded --workers=1 --max-failures=1`

Result: 1 passed (6.9m). See browser-tests.txt and screenshots. Browser evidence covers the shared-fit implementation before the follow-up preserving explicit user formatting/appearance overrides; 23 Fabric/adapter regression tests cover that follow-up, including scaled glyph-box containment and JSON reload projection. There is no production/deployment verification in this evidence.
