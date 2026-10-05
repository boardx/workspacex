# Shared outbox suspension repair — 2026-10-05

Base: 49c0c838d34530ab48dc0e04747b41da40ed32aa. Previous failed Board run: 37249732436 at 386785e1589e38a519450dfdad02a9ba12b4edef. Current base Board run: 37263596302.

The previous raw evidence shows peer authoritative sync at 9.8s, but held-update replay only at 52.7s, after origin resumed. The current base run passed the unchanged complete api-ws-objectstore lane: peer replay at 17.1s precedes origin resume at 17.8s, drain 12.7s under the unchanged 45s SLA. A single green run alone does not explain the earlier timing race.

An independent owned-context Chromium 151.0.7922.34 counterproof reproduces the native lock: an idle debugger-paused origin permits peer IDB writes; pausing in an unfinished write transaction prevents peer write completion until origin resumes. See idb-pause-counterproof.json. This is browser/IDB diagnosis, not product acceptance.

The test now observes native IDB transaction complete/abort events from before application startup. It schedules debugger suspension only in a JS task with zero active transactions, and records that fact before the actual Debugger.paused event. It neither changes durable data/claims nor renews/releases leases. Real hidden visibility, paused/resumed events, held server ACK, same-update peer replay, 24 unique server commits, reload convergence, original 45s SLA, and cleanup assertions remain required.

Current-base targeted command: pnpm --filter web exec vitest run tests/whiteboard/board-r01-oracle.test.ts tests/whiteboard/shape-projection-cache-policy.test.ts tests/whiteboard/whiteboard-provider.test.ts tests/whiteboard/whiteboard-outbox-indexeddb.test.ts — exit 0, 107 passed, zero skipped. The earlier README statement about the R01 oracle failure is historical and no longer reproduces on this base. This does not prove the eight-case native product matrix or original visual/hardware acceptance.

Formal R01/Connector/Files/Sync product suites remain NOT_RUN on this Mac. Hardware and deferred visual checks remain incomplete. No merge/deployment or existing database changes.

The exact-base verify-affected job 111615673455 subsequently failed six original toolbar tests. All six reproduced locally (6 failed / 13 passed). The merge moved the measurement ref from inner intrinsic content to constrained Dialog.Content. Restoring the inner content ref preserves compact sizing and directional placement while reserving the real submenu height. All original toolbar tests now pass (19/19), alongside three IDB observer counterexamples. No expectations were changed.

The repository browser diagnostic entry `node apps/web/e2e/support/board-indexeddb-quiescent-pause-browser.mjs` passed: suspension requested with one active transaction waits until its completion, reports zero active transactions, produces real Debugger.paused, and permits peer native IDB readwrite while paused. The bounded JSON is quiescent-pause-browser.json. This validates the changed controller, not the complete product lane.

`pnpm --filter web typecheck` and ESLint for all five changed source/test files exited 0. The first typecheck exposed the new observer's missing explicit `this: IDBDatabase`; that annotation was fixed before the successful rerun. Logs retain the original toolbar red and repaired green results.

Affected popover regression command: `pnpm --filter web exec vitest run tests/ui/board-tool-popover-above.test.tsx tests/ui/board-toolbar-position.test.tsx tests/ui/board-compact-chrome.test.tsx tests/whiteboard/board-indexeddb-quiescent-pause.test.ts` — exit 0, 43/43 passed, zero skipped; see popover-regression.log.
