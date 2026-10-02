> Historical snapshot, 2026-10-02. Not current approval, runtime acceptance, or feature status. See README.md and issue #5001.

# Sticky Mural UI Plan

Status: research and design input, not human signoff or delivery completion. Target is the phase-19 product whiteboard, not Mermaid conversion. Canonical core/Yjs remains authoritative; Fabric is disposable projection.

## Official Research Boundary

Sources: [Mural lesson](https://learning.mural.co/lessons/add-create-and-customize-sticky-notes) and [Mural sticky notes overview](https://www.mural.co/use-case/sticky-notes).

The lesson documents toolbar shape/color choices and dragging a chosen note to the canvas. It also documents double-click creation, Tab continuation and adapting nearby notes' shape/color. The overview describes drag-and-drop notes and collaborative organization. This is official-document research, not a logged-in Mural runtime audit. Neither source proves a current recent-choice persistence contract or exact selected-note toolbar design.

WorkspaceX retains the human-confirmed single-shot rule: successful click placement or drag drop creates once, then returns to Select. Double-click blank-space creation, Tab batching and nearby-note inference are not authorized by this research and must not be silently introduced.

## Current Implementation

- `board-sticky-picker.tsx`: eight core color presets, square/rectangle/circle choices, 44px hit targets, chosen color in every shape preview, native tool drag payload and existing bulk-create command.
- `board-tool-preview.tsx`: real square/circle/rectangle silhouettes; square/circle 24px, rectangle 30x19px. Dock and picker reuse the same visual primitive.
- `board-bottom-dock.tsx`: recent shape is local component state; chosen color is supplied by editor session state. Dock icon and drag payload use the active/recent variant and chosen color. There is no reload preference persistence claim.
- `object-context-toolbar.tsx`: selected-note appearance already offers preset/custom color, shape, text settings and size/sizing controls. This is distinct from the new-note picker. Selected shape icons are outlines rather than chosen-color paper previews. This source is outside tools owner's assignment; audit only.
- Editor owns creation, command dispatch, selection, text editing and selected-note updates. Surface owns world-coordinate drop projection and actual note rendering. Neither is edited by this task.

## Confirmed Bug And Minimal Repair

Dragging circle/rectangle directly from the picker previously wrote the correct payload but never selected that variant. The dock's recent shape therefore remained the previous choice after a successful drop. This violates the existing requirement that the dock express the chosen shape/color.

Focused counterexample: drag a pink circle while square is selected; verify exact circle/color payload and exactly one variant-selection callback. Before the repair the callback count was zero. The minimal repair selects the dragged variant in the existing dragStart handler; it adds no create callback and no pointer-up boundary. A cancelled drag may retain the user's chosen tool appearance but must create no object.

2026-10-01 focused validation: `pnpm --filter web exec vitest run tests/ui/board-sticky-picker-compact.test.tsx tests/ui/board-sticky-dock-paper.test.tsx tests/ui/board-reference-shell.test.tsx tests/ui/board-tool-drag.test.ts --no-cache` passed 4 files / 13 tests at 14:37:25. This also verifies controlled dock rerender after creation exit and the next dock drag retaining circle/pink. It proves UI callbacks/payload/state projection only, not a new live-browser drop run.

## UI And Interaction Plan

- Keep color swatches as swatches and shape controls as actual colored silhouettes, with independent accessible names and selected states. Do not replace them with text pills or a generic sticky icon.
- Dock immediately expresses the chosen shape and color, whether chosen by click or direct drag. Picker preview, drag payload and committed note must agree.
- Drag starts only from draggable enabled controls. Drop uses existing client-to-world conversion at current zoom/pan; creates one object and exits creation mode. Escape/cancel/rejected command must not create or leave a stale preview.
- Creation choices affect subsequent notes only; selected-note style edits change only the selected note through authoritative commands. Do not silently update the new-note preference when editing an old note without a product decision.
- At 390px, popup is limited to 358px with 16px gutters; maintain 44px controls and self-contained wrapping. Every enabled option center must hit its own DOM control, not an old selected toolbar. Root scrollLeft stays zero.
- Preserve selected-note text entry and existing bulk dialog. The Mural recommendation about standard note size is not a reason to remove WorkspaceX's existing resize/sizing capabilities.

## Decisions Requiring Approval

1. Recent choice lifetime: session only, board-local persisted preference, or account preference. Current behavior is session only; do not add localStorage/API without approval.
2. Whether editing an existing note changes future creation defaults. Default proposal: keep these concerns independent.
3. Selected shape/color previews fall under the existing human requirement, not a new interaction. Main authorized tools owner to update `object-context-toolbar.tsx`: trigger and both compact/expanded shape controls now reuse StickyToolPreview; unsupported legacy variant safely falls back to square. Palette inventory and callback behavior are unchanged.
4. Double-click empty canvas, Tab continuation, nearby-note inference and expanded bulk workflows are separate interaction decisions, not prerequisite bug fixes.

## Ownership And Actual Acceptance

Tools owner: `board-sticky-picker.tsx`, `board-bottom-dock.tsx`, `board-tool-preview.tsx` and focused sticky UI tests. Existing state/drag protocol is reused; no new schema or duplicate palette.

Editor/context owner: selected-note style edits, creation completion, text editing and preference lifetime. Canvas owner: actual silhouette/fill/text projection and drop coordinates. Changes must be coordinated rather than overlapping these sources.

Required live run: choose pink without first selecting circle, drag circle directly from picker at zoom; assert exact committed variant/color, one count increment, Select exit, dock circle/pink after completion, and next dock drag produces the same style. Repeat rectangle, cancellation, read-only denial, reload object persistence and second-client convergence. Reload creation-preference persistence is not required until its lifetime is approved.

Selected-note acceptance: change color/shape and verify object persistence, unchanged unrelated notes, unchanged future creation choice, Undo/Redo, locked/read-only rejection and real rendering. Narrow acceptance checks all color/shape/bulk options by elementFromPoint plus viewport bounds; native OS drag and physical touch remain separate evidence from synthetic HTML drag events.

The earlier P0 old-toolbar overlap is covered by the stronger tools visual gate. Main reported `/private/tmp/wsx-board-tools-menu-hit-run4` 7/7 real-browser PASS, including all-option hit testing; this predates the new direct-drag recent-shape repair and cannot substitute for its fresh product run.

Selected-preview counterexamples first failed 4/4 because trigger had no actual paper preview. After minimal reuse, `pnpm --filter web exec vitest run tests/ui/board-sticky-selected-preview.test.tsx tests/ui/board-contextual-toolbar.test.tsx --no-cache` passed 2 files / 20 tests at 14:40:51. Tests cover all three shapes, unknown-variant fallback, color, pressed state, callbacks and existing read-only controls. Actual browser appearance remains separately required.
