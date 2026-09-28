# Reference UI acceptance: failed

Exact runtime candidate: 609d147b1. Root ran playwright.board-reference-ui.config.ts in the isolated full-stack harness with WORKSPACEX_RELEASE_BUILD=1 and one worker. The test failed at board-compact-chrome-acceptance.spec.ts:18: selection layout toolbar did not appear after clicking Select and pressing ControlOrMeta+A.

The captured screenshot shows native browser text selection and zero selected Board objects. Thirty real API-created stickies were visible. Inspection found no Ctrl/Cmd+A selection handler in the editor. This is a product keyboard interaction gap, not an accepted screenshot or a nine-point experience. The remaining viewport, palette and mobile assertions were not reached.

The test environment exited with failure and cleaned its isolated stack. Full local trace: apps/web/test-results/board-reference-ui/board-compact-chrome-accep-b7cf0-entional-connection-handles-board-reference-ui/trace.zip (not committed).

Separately, Web tsc --noEmit passed after the meeting evidence type fix; the focused meeting CAS validator suite passed 13/13. Those checks do not establish visual, real Chat, or 30-minute meeting acceptance.
