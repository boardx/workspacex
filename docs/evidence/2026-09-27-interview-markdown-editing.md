# Expert and outline Markdown editing slice

Refs #4442; depends on #4439 and #4430. This slice continues without waiting for their merges.

The shared header now renders a connected, keyboard-accessible six-stage timeline with a separate return-to-list action. Explicit expert/outline routes load, edit, save and confirm versioned Markdown documents. The expert page uses the supplied live directory (no mock fallback), search/domain filtering, selected-role ordering/removal, stable-ID SVG avatar editing and a reviewed virtual-role draft modal. Outline block edits preserve the original heading reference and untouched raw content. Display projections use the same shared Markdown AST with immutable source ranges, not a second research body.

Tests observed RED then GREEN: missing accessible step navigation; missing AST block/link projections; absent expert/outline components and route integration; generation silently discarded an unsaved edit. Focused UI regression: 32 tests passed. Shared contracts full suite: 99 files / 956 tests passed. Web typecheck and changed-file ESLint passed.

Web full suite is running. Six failures were observed in whiteboard/board-content-tools.test.tsx; that module is not changed here and an isolated rerun is being recorded. This is not a claim of a green full suite or merge readiness.

Remaining: question-level grouping/reordering polish, virtual-role model generation, confirmed-document revision flow, legacy setup removal and execution/report source cutover. The modal adds reviewed Markdown to the local draft; final persistence is the explicit Save expert draft action. Avatar preferences remain browser-local as disclosed. This slice does not prove full prototype parity, real-model success or browser acceptance; no merge/deployment was performed.
