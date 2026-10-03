> Historical snapshot, 2026-10-02. Not current approval, runtime acceptance, or feature status. See README.md and issue #5001.

# Connector Independent Design Review

Date: 2026-10-01. Status: proposed decisions, not signoff or execution evidence.
Only review material is added. No schema, feature status or business source is changed.

## Current Consistency

Reviewed execution-plan, contract-audit and acceptance drafts. The expanded user
scope includes path handles, durable width and label position in this round.
Acceptance C01-C21 correctly makes these required. Contract-audit's earlier
"P1 / separate contract increment" means an unsigned increment, not permission
to postpone them. Its no-new-fields basic edition cannot satisfy this round.
The confirmed board-fabric-surface bundle covers BV01-BV03, not BV13. Scope
confirmation is not confirmation of the UI/use-case/API design materials.

Latest contract and geometry revisions now agree on one candidate: curve controls
are world-axis vectors relative to their own endpoints; elbow controls are bounded
world guide points. Baseline-frame controls are a rejected tradeoff, not a second
runtime candidate. Width is optional with legacy rendering width 2; absent label
position preserves legacy bounding-box placement, while explicit position uses
arc length. These are reviewed proposals, not signed schema or implemented UX.
All path/width/label requirements remain required in this round.

Official FigJam documentation establishes a persistent connector tool. The
approved local single-shot requirement is a deliberate difference. Neither
these documents nor this review prove actual FigJam browser experience.

## Decisions Before Signoff

| Decision | Recommended proposal; human confirmation still required | Required alignment |
| --- | --- | --- |
| Straight handle | Endpoints only, no interior curvature. Whole-line movement is available only when both ends are free; type switching enables elbow/curve controls. | Revised C14 resolves the earlier impossible fixed-endpoint straight curvature requirement; UI must preserve this distinction. |
| Modifier bypass | Choose free world endpoint or attached local offset inside the object. The official article describes avoiding side snapping, but does not establish its persisted binding representation. Free endpoint is this product's proposal, not an official FigJam storage fact. | C05 must test the selected meaning by moving the target afterward: free stays fixed, attached offset follows the target. |
| Elbow controls | Use bounded structured orthogonal route controls, not arbitrary SVG. Specify axis/order, maximum controls and behavior when endpoints cross or coincide. | Renderer, handle placement, hit testing and bounds consume one path evaluator. |
| Curve controls | Explicitly define the number and coordinate space of Bezier control points and whether endpoints move their adjacent control points. | No renderer-only control persistence or second geometric model. |
| Control coordinates | Latest single candidate is endpoint-relative world-axis curve vectors and world elbow guides. Single-end move affects that curve control only; common translation moves elbow guides exactly once. Node rotation does not rotate the world-axis vectors. | Preview and committed path must agree at nonzero pan/zoom; cancel restores controls and bindings atomically. |
| Label location | Recommend a normalized arc-length parameter on the evaluated path, not a normalized x coordinate or Bezier t masquerading as distance. Decide whether perpendicular offset is supported and its units. | Specify projection of pointer to path, tie-break on crossings, clamp, zero-length fallback and behavior after type/path/endpoint changes. |
| Width | Recommend positive finite world-unit width, scaled by viewport, with bounds/default selected by the schema owner. | Arrow size, dash pattern, hit tolerance and bounds rules must be explicit; UI preview and persisted paint use the same width. |
| Backward compatibility | Missing new fields derive exactly the old route, old renderer width and old label location. Explicit malformed values must reject, not silently default. | Old saved boards, clipboard, duplicate, backup and portable roundtrips retain behavior; import rejection cannot satisfy required roundtrip acceptance. |
| Type switch | Define conversion/reset of incompatible controls and the fate of label position in one atomic command. | Switching straight/elbow/curve cannot keep hidden stale controls that reappear later without an explicit rule. |
| Concurrency | Define rebase or conflict response for target geometry changes during handle drag; deletion/revocation cancels or rejects safely. | Browser undo compensation and public receipt-based undo are distinct contracts; do not promise interchangeable behavior. |
| Interaction | One successful creation returns Select. Controls/label preview write no canonical data; release produces one command batch/undo entry. | Esc, pointercancel, lost capture, blur, tool change, archive/revocation and remote deletion have explicit outcomes. |

Do not copy numeric bounds/defaults into multiple authoritative documents. Once
chosen, schema is the executable source; UI and acceptance reference it.

## Required Review Gates

P0: C01-C06/C09-C13/C19-C21 and data integrity, permissions, target lifecycle,
single transaction, cancellation, independent two-browser convergence and
backward compatibility. P1 execution order: C07-C08/C14-C17 for path controls,
width and label position. Here P1 means ordering, not deferral: all are required
for the expanded round. Style memory and bulk style remain explicit optional
parity unless human scope adopts them.

Before implementation, align the path discriminant/control representation,
width, label location and defaults across the six owner proposals; resolve the
straight-handle ambiguity; supply UI/use-case/API materials and obtain human
signoff. No owner should independently add extensionData fields or controls.

Remaining precision checks: distinguish paste/duplicate translation of free
points and elbow guides from no-translation backup roundtrips; agree on elbow
orientation and handle counts in actual UI examples; reconcile geometry's
1-screen-pixel label oracle with acceptance's generic 2-CSS-pixel endpoint rule.
Use the stricter label-specific requirement, not a tolerance inferred from a
failed run. Modifier local-offset versus free-endpoint choice remains pending.

Acceptance must include degenerate paths, reversed endpoints, crossing elbows,
curve self-intersection label projection, extreme legal widths, zoom/DPR pixel
normalization, actual endpoint/label/path handles, and type switching. Bounds,
hit testing, culling and routing must include cap/arrow/label extents without
changing canonical endpoint identity. Preserve existing drawing cache and
connector offset fixes when integrating.

## Delivery Boundaries

Candidate connector commands are not implemented or run. An existing test name,
official article or screenshot does not prove user interaction or persistence.
Use exact dirty-source hashes, real pointer input, API snapshot/ACK readback,
fresh screenshots and strict runtime-error gates for the eventual evidence.

The previous board round still has unfinished CI Chromium provisioning and
sync request-abort classification. Keep these visible independently; new
connector planning must not turn the previous red gate into a completion claim.
GitHub connector issue lookup failed during review, so live issue/PR deduplication
is unresolved, not evidence that no issue exists. One issue/PR per agreed scope,
no branch switch or direct merge, and no passing status before the required gates.
