# R9 AI Organize confirmation experience

Adhoc refinement of the actual `iteration-09-real-model/18dfb0e58` screenshots. No model, proposal, permission or persistence contract changes.

- The AI action shares the bottom tool dock. Assistant selection, status and server-authoritative undo live behind the accessible “AI 整理选项和状态” button. Failures open this status dialog instead of silently disappearing.
- Preview is a keyboard-accessible confirmation dialog. It shows input count, themes, per-theme sticky count and a miniature layout. Technical provenance and revision remain available in a collapsed details disclosure. Existing proposal/action test IDs remain intact.
- Successful confirmation creates a local viewport intent. It waits until canonical Yjs objects have the expected geometry, then fits the organized content with reserved header/dock space. It animates for 240ms unless reduced motion is requested. Remote updates alone never create this intent. Manual pan/wheel cancels a pending or active fit; undo clears the request.

## Main-session browser acceptance

Use the real-model lane and retain screenshots at 1440×900, 1280×720 and 1024×768:

1. Select 30 stickies and click `board-ai-organize` in the dock. Ensure the four core tools remain accessible and no AI card occupies the canvas corner.
2. Confirm the proposal dialog shows themes/counts; technical details are collapsed. Snapshot/revision must remain unchanged before confirmation. Escape/cancel must preserve zero-write semantics. Busy confirmation must not dismiss through Escape.
3. Capture the initiating client's viewport and an independent peer's viewport. Confirm, wait for canonical objects and animation. Organized content must be inside the editor's header/dock safe area. The independent peer viewport must remain unchanged.
4. Under delayed document delivery, manually pan before the result arrives; the late result must not pull the user back. With reduced motion enabled, fitting must be immediate.
5. Open “AI 整理选项和状态”, then click the unchanged `board-ai-undo` test ID. Verify one server receipt undoes the whole action; intervening edits must still produce the existing conflict message without overwriting them.
6. Verify modal focus containment, Escape return focus, narrow-screen scrolling and the visible error state. Review screenshots manually; passing automation does not imply a subjective nine-point score.

## Local verification

- `pnpm --filter web exec vitest run tests/whiteboard/board-ai-api.test.tsx tests/whiteboard/board-organize-controls.test.tsx tests/whiteboard/board-organize-fit.test.tsx tests/whiteboard/live-board-collaboration-status.test.tsx` — 14 tests passed.
- `pnpm --filter web exec tsc --noEmit` — exit 0.
- No browser, Docker or live-model run was performed by the implementation worker.
