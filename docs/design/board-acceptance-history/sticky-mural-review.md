> Historical snapshot, 2026-10-02. Not current approval, runtime acceptance, or feature status. See README.md and issue #5001.

# Sticky Mural Independent Review

Date: 2026-10-01. Status: research and proposed review gates, not signoff,
implementation acceptance or actual Mural browser experience.
No business code, feature state or signoff status is changed.

## Official Sources And Limits

- [Official lesson](https://learning.mural.co/lessons/add-create-and-customize-sticky-notes): palette selection followed by drag placement; canvas double-click creation; Tab adds subsequent notes; nearby notes can influence color/shape. The lesson recommends zoom rather than resizing notes. That is guidance, not proof resizing is impossible.
- [Official use case](https://www.mural.co/use-case/sticky-notes): shape/color, editable text, organization and tags are advertised. This is product description, not a detailed transaction, IME or permission contract.
- [Official create API](https://developers.mural.co/public/reference/createstickynote): creates one or more sticky widgets, up to 1000, with murals:write scope. The rendered reference does not expose the full body object here; do not infer undocumented text/geometry/tag fields or atomicity.

Only the above documents were researched. No authenticated Mural session was
operated; no claim about current latency, pointer handling or OS input is made.

## Scope Gate

Existing single-shot creation, palette drag-out and preview defects may be fixed
within current R2 responsibilities. Double-click rules, Tab continuation,
nearby-style inheritance, richer text, bulk operations and tags need explicit
product scope and UI/use-case/API decisions. Existing source paths are not proof
of prior design approval or end-to-end acceptance.

Single-shot return to Select is a local product requirement. Mural's documented
Tab continuation is a separate interaction: specify focus, positioning, inherited
style, one-note-per-keypress, IME guard and cancellation before adopting it.
Do not silently expand current fixes to match every advertised competitor feature.
The board-fabric-surface signoff covers BV01-BV03; it does not automatically sign
new Sticky workflows or data fields. Human confirmation remains required.

## Current Code Review Map

- `board-sticky-picker.tsx`: square/rectangle/circle, selected color, native drag payload and bulk entry. Real placement must retain selected variant/color, not merely highlight a menu.
- `collaborative-thinking-editor.tsx`: creation, double-click wiring, commitEdit and continueSticky; canonical writes still pass through the existing command layer.
- `thinking-input-editor.tsx`: composition guard, deferred live commit, blur, Escape and Tab. Escape currently flushes scheduled live text before closing, so do not describe it as a text rollback without an explicit product decision.
- `packages/whiteboard-core/src/thinking-input.ts`: variants and placement helpers; Fabric geometry/layout are projection, not a second stored text model.
- `fabric/board-fabric-surface.tsx`: actual hit testing, creation mode, group layout and coordinate transform. Shape/text updates must preserve the canonical frame except an explicitly intended auto-height change.

These are source observations, not tests executed for this new scope.

## Required Acceptance Before Delivery

| Gate | Observable result and rejection proof |
| --- | --- |
| Creation | Actual palette drag to blank and occupied canvas at nonzero pan/zoom creates exactly one selected-style note; before release no new canonical note; successful release returns Select. Plain subsequent click creates none. |
| Cancel | Esc, pointercancel, blur/lost capture, drag outside canvas and tool change clear preview/capture and produce no extra note. A later valid gesture still works. |
| Chinese IME | Enter/Tab/Escape during composition do not prematurely finish or create a note. Composition-end preserves final Chinese text exactly; blur/reselect/reload do not lose committed text. Synthetic composition events do not prove native OS IME. |
| Edit loss | Debounced text, blur, remote deletion, lock/read-only transition and failed write have explicit outcomes. Test live-committed Escape separately from uncommitted cancellation; no stale callback resurrects a deleted note. |
| Geometry | Square/rectangle/circle actually render and hit-test correctly. Editing/auto-height/reflow does not unintentionally resize circle, move center or alter unrelated objects/connector anchors. Test rotated/scaled notes and long Chinese text. |
| Permission | Viewer/commenter, locked object, archived board and mid-gesture revocation cannot create/mutate. UI disabled is insufficient: API denial and unchanged authoritative head must be shown. |
| Undo | A creation gesture is one undo entry. Text-session coalescing and any future bulk creation need separately signed semantics; many successful debounced writes do not prove one-session undo. Undo must not erase unrelated remote edits. |
| Persistence | Real API snapshot/ACK, fresh reload and a second independently launched browser confirm text, style and geometry. Two contexts or a seeded object alone do not prove user creation or durable synchronization. |
| Narrow view | Palette, toolbar and note text fit; verify actual elementFromPoint at control centers, root scrollLeft and actual pointer hit targets, not only menu bounding boxes. |

## Anti-False-Green Rules

Use fresh real owner/viewer fixtures and exact source/script hashes. Record
actual pointer coordinates, canonical before/live/after, independent world/CSS
geometry and targeted PNG ROI. Menu selection, mock API, source strings and
canvas-wide ink differences cannot substitute for the actual note paint.
All assertions, unexpected console/pageerror and missing artifacts fail closed.
Expected denial/network injection must be precise and cannot blanket-ignore 4xx
or abort errors. Report executed/pass/fail counts and incomplete scope separately.

Candidate tests/commands must remain marked not implemented/not run until
executed. Native Trackpad, OS clipboard and Chinese OS IME need their own device
evidence; browser event synthesis alone cannot claim those passed.

Six-owner drafts are pending independent cross-review. Record exact decisions
and discovered defects here only after reading those drafts and actual evidence;
do not predeclare the new workflow or the prior round fully complete.
