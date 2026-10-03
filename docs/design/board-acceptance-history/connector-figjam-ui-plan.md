> Historical snapshot, 2026-10-02. Not current approval, runtime acceptance, or feature status. See README.md and issue #5001.

# Connector UI Plan

Status: development authorized, acceptance pending. Human approval relayed by main coordinator on 2026-10-01: "我批准你先完成开发". This records the supplied approval phrase, not a fabricated signature or changed design-signoff status. Connector entrance remains gated until integrated and tested; Frame remains hidden.

## Reference And Product Boundary

Official reference: https://help.figma.com/hc/en-us/articles/1500004414542-Create-diagrams-and-flows-with-connectors-in-FigJam

FigJam offers straight, bent and curved connectors, attachment to moving objects, independent end styles, color, weight, line pattern and labels. Its connector tool remains active until another tool or Escape. WorkspaceX deliberately creates once: a successful connector returns to Select; Escape cancels the pending connection without creating anything. This is a product difference, not an incomplete imitation.

## Current Source Audit

- `board-bottom-dock.tsx` contains an unreachable connector picker with three text buttons, but no visible entrance and no path preview.
- `collaborative-thinking-editor.tsx` embeds the selected connector relation inspector: label, semantic relation, path, line pattern and two end styles. Appearance currently requires expanding the inspector. Color and thickness controls are absent.
- `fabric/board-fabric-surface.tsx` already renders three path kinds and solid/dashed/dotted patterns; connector stroke width is hardcoded to 2 in both Line and Path branches. Color reads object.style.stroke. Label is a fixed-size Textbox with white background.
- Existing tips are none/arrow/circle/diamond. These are the product's current contract, not FigJam's larger endpoint inventory.
- `completeConnector` clears the pending source but does not clear creationTool or return to Select after success. Editor integration must implement the intended single-shot transition.

## Creation States

1. Select: no creation highlights; connector entrance stays hidden for the present release.
2. Armed: selected path icon is visible in the dock when the entrance is eventually enabled. Prior object context toolbars are suppressed. The picker uses three genuine path previews, not three copies of a generic arrow.
3. Source hover: four side-center attachment points appear on the eligible object. Hovered point receives a visible ring. Locked or unsupported targets cannot appear actionable.
4. Source chosen / dragging: one transient line follows the pointer; a valid destination is highlighted and its four points are exposed. Invalid targets have no success highlight. No canonical connector is created before completion.
5. Complete: commit exactly one connector, select it, clear pending state and creationTool, return to Select. Preserve a single primary pointer callback; do not add a second pointerup/native click creation boundary.
6. Cancel: Escape, tool change, read-only transition or lost gesture clears preview and pending state. No object is created. A rejected command keeps a clear retry state rather than reporting success.

Existing selected connectors expose independent start/end handles. Dragging an endpoint previews attachment to a valid target; commit on the existing command boundary. Free endpoint behavior must reuse existing fromPoint/toPoint fields and core validation, not invent a parallel model.

## Picker And Selected Toolbar

- Preview primitives: straight diagonal segment; elbow with an actual orthogonal corner; curve with an actual cubic bend. Match renderer path semantics and tip tangents. All choices have accessible names and selected states; SVGs are decorative inside labeled buttons.
- Selected toolbar order: path menu, color swatch, numeric thickness control, solid/dashed/dotted icon menu, start tip, end tip, label command. Use familiar icons with tooltips, real visual previews for line/tip menus, and no text-only pill substitutes.
- Base tip menu: none, arrow, circle, diamond, independently for both ends. Read-only and locked states disable mutation controls consistently.
- Label opens a compact text editor; commit/cancel must be explicit and avoid an undo command per keystroke. Keep semantic relation in advanced inspector rather than mixing it with everyday appearance.
- Floating toolbar positioning must avoid the active picker, endpoint handles and label editor. Hide previous selection chrome while any creation tool is armed. Opening a new popover closes the previous one; Escape dismisses the highest active interaction first.

## Responsive Geometry

- Desktop controls use stable 36px visual cells with at least 44px hit targets where appropriate. Toolbar is content-width, capped by viewport minus 32px; path picker uses three equal cells.
- At 390px viewport, outer dock and popovers fit the 358px available width with 16px side gutters. Toolbar wraps into two deliberate rows or moves secondary actions into a menu; it must not force editor horizontal scrolling.
- Menu content is self-contained. Every enabled option's center must hit its own button or descendant via elementFromPoint. Bounds alone are insufficient evidence.
- Position updates must account for zoom, pan, resize and object changes. Attachment points and handles remain in the correct screen coordinates after zoom, rather than using unscaled object coordinates.

## Contract Scope

Existing-field portion uses type, lineStyle, startStyle, endStyle, label, semanticRelation, anchors, offsets and free points. Color uses existing style.stroke. Canonical WhiteboardStyle has no strokeWidth: projection-local optional width is not a persistence contract. Thickness therefore requires the reviewed connector field addition, not merely a toolbar or Fabric option. Relationship updates and object style updates retain their existing authoritative command paths.

This iteration also includes persisted path handles and label position, not a deferred batch. Schema owner must define authoritative elbow/curve control-point and label-position fields, coordinate semantics, defaults for legacy objects, validation and migration boundaries. Canvas owner must use those same fields for live preview and committed rendering. UI consumes the authoritative types; no parallel local geometry schema. Label position must survive reload and remain on the path after endpoint/object movement. Thickness is included in this iteration with matching actual Canvas output.

The single candidate is the endpoint-relative curve/world-guide elbow route described in `connector-figjam-geometry-plan.md` and the field bounds in `connector-figjam-contract-audit.md`. Curve handles edit endpoint-relative world-axis vectors; elbow segment handles edit world-axis guide constraints, not arbitrary diagonal vertices. Straight connectors have endpoint handles but no route controls. Label dragging uses normalized arc length and signed normal displacement from the shared resolved path, not the cubic parameter or bounding-box percentage. Legacy absent label position retains current bounding-box-centre behavior. UI examples must show one-end movement versus equal movement of both ends: curve controls follow their own endpoints; elbow guides stay board-fixed for one-end movement and translate once with equal two-end movement. No competing baseline-frame route candidate is proposed here.

Remaining P1 candidates require separate review: extra tip types, configurable label background, rich label marks and style preference persistence. Do not represent persistent features as transient UI state that disappears on reload. Bulk connector editing is separate until mixed values and atomic command behavior are defined.

## Ownership And Verification

- Tools owner: new `board-connector-preview.tsx`, `board-connector-picker.tsx`, `board-connector-toolbar.tsx`; corresponding focused UI tests; isolated dock composition after approval. Existing shared tool preview need not be refactored.
- Editor owner: integration callbacks, single-shot state transitions, selection/pending state and creation-time suppression of old toolbars. Tools owner does not edit editor.
- Canvas owner: attachment hit testing, transient path, endpoint handles, actual stroke-width rendering and screen/world coordinate correctness. Tools owner does not edit Fabric surface.
- Core/contract owner: this iteration's path-handle/label-position schema after review; remaining P1 additions separately. No duplicate local enum authority.
- Tests: distinct preview geometry, all patterns/tips, controlled values and disabled states; real browser endpoint and path-handle dragging at zoom; exactly-one create and Select exit; cancel/rejected-command paths; reload style/label/path-control/label-position persistence; drag label along straight/elbow/curve and move endpoints afterward; 390px and desktop all-option hit tests; real Canvas path/color/thickness/tips matching controls. Legacy connectors without new fields retain their existing default path and label rendering.

## P0 Regression: Narrow Menu Obstruction

Fresh suite-run3 PNGs showed old Caption context toolbar covering the shape menu's third row and old Triangle toolbar covering the sticky menu bottom at 390px. Menu bounds and one successful triangle click did not prove the remaining choices usable. Evidence: `/private/tmp/wsx-board-acceptance-suite-run3/tools/narrow-shape-menu.png` and `narrow-sticky-menu.png`.

Required fix belongs to editor owner: suppress previous selected-object chrome for every armed creation mode, not just drawing/eraser/panel. Required gate belongs to tools visual acceptance: check elementFromPoint for every enabled submenu option, alongside viewport bounds, root scrollLeft zero, real creation over an existing object, exactly-one count and return to Select. No scroll reset, blank-point substitution or reduced menu inventory is allowed to hide this regression.

## Minimum Signoff Materials And Test Breakdown

Before restoring the connector entrance, human UI signoff needs actual state illustrations for desktop and 390px: three path choices; four-side source/target feedback; held drag and invalid target; selected toolbar and all style menus; straight endpoint controls versus elbow segment guides versus two curve controls; dragged label; read-only/locked controls. Include examples of one-end move, equal two-end move and node rotation so route semantics are visible rather than buried in API prose. A static toolbar sketch alone cannot approve these states.

The use-case/API decisions still needing one explicit answer are modifier interior-drop storage (bound local offset versus free point), elbow orientation/handle count, locked target policy, deletion policy, copy outside-selection policy and concurrent field updates. Numeric bounds stay in contract audit then canonical schema, not duplicated here. Path handles, persisted thickness and label position are mandatory this round; unsigned detail is a blocker to implementation, not permission to omit the behavior.

Executable decomposition after approval:

1. Tools UI tests: three distinct previews, exact controlled values, existing enum inventory, start/end independence, label editor commit/cancel, disabled state and responsive stable control dimensions. New focused files may be `board-connector-preview.test.tsx`, `board-connector-picker.test.tsx` and `board-connector-toolbar.test.tsx`; these are proposed files, not existing passing tests.
2. Geometry/core tests: shared path resolver, endpoint-relative curve vectors, orthogonal elbow guides, degenerate endpoints, arc-length label oracle, legacy defaults and one-gesture commands. Contract/files owner separately proves schema rejection and roundtrip preservation.
3. Real pointer product script: acceptance C01-C10, C14-C16 and C21; hold pointer to verify no pre-release write, then actual API ACK/readback and real Canvas path/width/tip/label pixels. Never seed a connector to claim UI creation.
4. Durable and independent-browser script portions: C11/C17/C18 for reload/copy/import and convergence; C12/C19/C20 for viewer/commenter/revocation/locked/deletion paths. Owner session is not a permission fixture.
5. Responsive portion C13: 390px and desktop, all enabled menu centers hit their own controls, root scrollLeft zero, endpoint/control/label gestures at nonzero pan and zoom. Existing Sticky menu 7/7 proves the old obstruction fix only, not new connector menus.

The canonical candidate command and C01-C21 matrix live in `connector-figjam-acceptance.md`. Its script is explicitly not implemented/not run. All required cases must have executed checks, PNG hashes and exact counts on fresh frozen source before entrance restoration. Existing dormant picker/native-select inspector remains audited legacy source, not a completed new toolbar.

Development progress: isolated ConnectorToolPreview and controlled BoardConnectorPicker now render distinct line/elbow/cubic examples, patterns and existing tips. BoardConnectorToolbar references core ConnectorRelationship plus canonical WHITEBOARD_CONNECTOR_LIMITS and provides path/color/width/pattern/independent tips/multiline label save/path reset/explicit arc-label centering. Width commits on blur, label commits on explicit save, and changing path kind clears old route controls. Current start/end triggers show actual selected tips. Eight focused picker/toolbar tests pass with --no-cache at 15:25:26; the gate test covers default-hidden entrance, explicitly enabled entrance, selected curve preview and absent Frame. Dock has a new `connectorEnabled` controlled gate defaulting false; editor owner must deliberately enable after integration and evidence. This is not an acceptance or completion claim; geometry/gesture/editor integration and live C01-C21 remain required.

Controlled overlay handoff: `board-connector-handles.tsx` consumes shared ResolvedConnectorPath, ConnectorRelationship and BoardViewport; uses core handles/label placement/SVG conversion; renders fixed 44px screen-space endpoint/route/label targets, actual SVG stroke target only for fully free-edge translation, transient styled path and rotated snap-target cue. It forwards pointer down/move/up/cancel/lost-capture events to editor owner and owns no capture, gesture state or canonical write. Source four-side anchors remain editor integration responsibility. Label glyph preview must follow the same temporary projection, not a second text renderer in the overlay. Four focused tests passed --no-cache at 15:55:03. Full web typechecking is centralized by main/editor owner to avoid concurrent CPU-heavy duplicate runs; this component's standalone tsc attempt was stopped on main instruction and is not claimed passing.

Cross-review correction: snap cue must use canonical top-left rotation, not rotate an unrotated centre. An independent trigonometric screen-position counterexample failed with a 38.397px horizontal difference; reusing core scenePointFromLocal for the local centre fixes the cue. Four overlay tests passed --no-cache at 16:01:14. Test viewport fixtures include required fitRequest:0 rather than broadening the type. This still does not prove integrated browser gestures or canonical submission.

2026-10-01 targeted Sticky/tools regression refresh: six files / 33 tests passed with `--no-cache` at 15:03:15 (`board-sticky-picker-compact`, `board-sticky-dock-paper`, `board-sticky-selected-preview`, `board-contextual-toolbar`, `board-reference-shell`, `board-tool-drag`). This is current unit evidence, not Connector or Mural live-product proof.
