# Root reference UI acceptance — 0d3024a8d

2026-09-27. Real isolated API/PostgreSQL plus browser; one worker. Command: `WORKSPACEX_RELEASE_BUILD=1 NODE_OPTIONS=--max-old-space-size=3072 PGUSER=postgres PGPASSWORD=<local fixture> FULLSTACK_E2E_SERVER_TIMEOUT_MS=1200000 pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter web exec playwright test --config playwright.board-reference-ui.config.ts --workers=1`.

Exit 0: 1 test passed (1.7m); total wrapper 1m45s, cleanup 1s. Covers real 30-note creation, Ctrl+A, fit-board bounds, compact header/navigation/selection toolbar, single selection via accessible object outline, sticky palette containment at 1024/1280/1440, mobile header button containment at 390, explicit connector intent showing 120 handles and select mode clearing them.

Root visually inspected 1440 palette and 390 mobile screenshots: sticky paper icon restored. Remaining visual gaps: picker overly tall, brand undersized. Mobile screenshot retains prior desktop zoom; this test does not prove mobile fit-board or complete touch usability. Screenshots are evidence of current behavior, not a 9/10 approval. Real vendor samples, storage recovery, AI/room/load acceptance remain separate gates.
