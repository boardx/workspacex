# Organization custom template Board handoff — issue #6454

Validated implementation: e294567aa (evidence-only follow-up adds this directory).

The isolated real browser test passed: `pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter web exec playwright test --config playwright.fullstack-smoke.config.ts --project=seeded chat-board-target-placement.spec.ts --max-failures=1` (1 passed; 5m5s including production build).

The project scope uses a unique organization-owned published user-edited template with six explicit sections in a 3×2 grid and pink default stickies. The test asserts six sections; real source save/readback precedes actual Board handoff; every canonical object text and geometry matches; all actual Fabric objects are in the viewport; all six content objects survive reload. Existing Board objects remain unchanged. The organization-target scope also verifies pagination and persistence with a Mermaid diagram.

Boundary: assistant-message setup is inserted into an owned isolated thread. Model generation is not executed. API and browser requests are real and not intercepted. This proves the tested handoff path, not the unique cause of the production trace reported by the user.

Additional validation: whiteboard unit suite 807 passed, organization regression 1 passed, fabric-markdown 300 passed, Web layout 111 passed, pre-push affected typecheck/lint 35/35 passed. Expanded API canvas suite: 498 passed, 6 failed (model simulate/suggest requests returned 402 credit_required); not claimed green. Independent review cleared trusted-spec serialization and process-registry isolation.

Owned Docker stacks released after the browser run. PR #6455 targets develop; no merge or deployment performed.
