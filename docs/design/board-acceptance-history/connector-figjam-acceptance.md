> Historical snapshot, 2026-10-02. Not current approval, runtime acceptance, or feature status. See README.md and issue #5001.

# Connector Acceptance Standard And Execution Evidence

Status: required execution standard under the user's development authorization; complete C01-C21 evidence is not green. Pointer subset candidates and actual failed attempts are recorded below, never treated as full completion.

## Human-Approved Chrome Revision

The human additionally approved single-Connector selection without a blue rectangular bounding box
and a compact, function-complete icon toolbar. Actual endpoint/path/label handles remain operable;
ordinary-object and multi-selection behavior must not regress. Verify wide/narrow toolbar fit and
real hit targets, plus latest frozen-source selected/unselected screenshots for human acceptance.
This records approval without changing human signoff status. The execution combinations and history
are in [matrix plan](connector-matrix-acceptance-plan.md): old full24 run2 (24/24 scenes, 88/88 checks)
is real **old chrome** evidence, not acceptance of this new UI. New chrome checks remain pending.

Subsequent human UI requirements: at 390px, selected submenu is anchored above the object/Connector,
not fixed to the viewport bottom, and the shared positioning path is checked across widgets.
Line-style uses a horizontal preview; start/end style controls share one endpoint-style entry rather
than three ambiguous diagonal icons. Preserve both endpoint choices and all supported commands.
Require independent multi-kind/wide-narrow positioning and fresh actual screenshots; old desktop24
or narrow9 passes predate these additions and do not close them.

## Reference and product decisions

Official reference: [Create diagrams and flows with connectors in FigJam](https://help.figma.com/hc/en-us/articles/1500004414542-Create-diagrams-and-flows-with-connectors-in-FigJam).
The article establishes drag creation, attachment to shapes/stickies and movement following, endpoint reassignment/free endpoints, Command/Control snap bypass, editable paths, color/dash/weight/labels/end styles, and edit permission. FigJam keeps its connector tool active until another tool or V/Escape is selected. The official diagramming video demonstrates four connection points: [Figma diagramming](https://www.figma.com/figjam/how-to-use-figjam-to-make-diagrams/).

Product-specific decisions, not FigJam claims: one successful creation returns to selection; an empty click never creates a zero-length edge; four cardinal anchors show candidate feedback; resize/rotation following, cancellation, undo atomicity, durable reload and narrow/zoom correctness are required regression guarantees. Historical design considered interior local binding versus absolute free endpoints. Under the user's explicit development approval, the conservative implementation uses absolute free endpoints for modifier bypass as specified in C05. This is not a claim that the human chose a historical A/B label or that an agent edited signoff. Path types, styling fields and defaults refer to `packages/contracts/src/whiteboard-document.ts`; unsupported required choices fail rather than silently mapping to straight/default.

## Harness and evidence

Use a real authenticated owner session, fresh actual /studio/board/:id and actual API. Validate identity/current organization and exact canonical revision. Seed only nodes/fixtures via validated API; every connector under test is created/edited through real pointer input. No Fiber/Fabric mutation, mock persistence or seeded edge counted as UI creation. A second real viewer session proves permission independently.

Each case records Given snapshot/head, exact pointer client positions/modifiers, live screenshot, read-only rendered scene, committed API snapshot/head, and reload screenshot. Hold mouse down for live evidence; canonical must remain unchanged until pointerup. Wait on actual preview state plus two animation frames, then actual saved ACK; do not use arbitrary sleeps as proof. Errors/pageerror fail unless separately approved precise injection classification. Keep prior sync ERR_ABORTED strict gate unchanged.

Independent geometry oracle: screen = host origin + pan + zoom * world. Canonical geometry rotates local points around its unrotated top-left origin: world x = geometry.x + localX*cos(angle) - localY*sin(angle), world y = geometry.y + localX*sin(angle) + localY*cos(angle). Use cardinal local anchor coordinates and independently computed trigonometry; bound endpoint must equal that world position. Do not call the production relationshipGeometry helper as the only oracle. Compare object IDs/anchor enums exactly; expected world floats within 0.01 units, visible endpoint center within 2 CSS px. Quantization permitted only when signed snapping rule computes its exact expected value; do not enlarge tolerances from observed failures. Pixel ROI verifies colored path exists outside handles/labels and is not stale selection ink; RGBA change and path position must agree with geometry. Capture full viewport and targeted ROI with PNG signature/bytes/SHA, script SHA, start/end timestamps and check names.

## Given / When / Then Matrix

| ID | Given | When (real input) | Then / required evidence |
| --- | --- | --- | --- |
| C01 Creation | Fresh nodes A/B, no connectors | Select connector; drag A right to B left | Target cue appears while held; 0 canonical edges before up, exactly 1 after; correct A/B IDs and anchors; path ROI nonblank. Next empty click produces no second edge and selection mode is active. |
| C02 Four sides | Asymmetric node sizes, isolated destinations | Create or reconnect to top/right/bottom/left in four cases | Exactly matching anchor for each; live target highlight follows candidate and clears outside snap zone; screen endpoint matches independent rotated cardinal oracle. Nearest-side threshold boundary tested just inside/outside approved radius. |
| C03 Reconnect | Existing A-to-B edge, same ID | Drag end handle from B to C then B another side | During drag canonical unchanged; pointerup preserves connector ID, updates only requested endpoint; old B movement no longer moves end; C movement does. |
| C04 Detach | Bound end at C | Drag endpoint into clear canvas | Attachment ID/offset removed, explicit world point persisted; C move has no effect. Both ends detached: whole-edge drag translates both absolute points equally, preserves path/style. |
| C05 Modifier | Bound edge and node under desired endpoint | Hold actual Meta on Mac / Control on other platform while dragging end into node interior | No side-snap cue; endpoint matches inverse screen transform and persists as a free world point, without target binding/offset or following subsequent target movement. Release modifier resumes side snapping. This is the coordinator's conservative implementation choice under the user's development authorization, not a claim that the human selected an A/B label. Run browser modifiers without claiming OS hardware validation. |
| C06 Following | A/B edge, asymmetric node A | Drag A; resize via actual control; rotate via actual rotation handle; multiselect A+B and move | Live endpoint follows each frame before commit, ID/anchor preserved; independent rotated oracle matches live and committed positions; opposite endpoint unaffected for single-node operations; multi-move translates both by same vector. No imperative rotation API. |
| C07 Path edit | Bent/curved edge with a clear obstacle | Drag actual middle/path handle around obstacle | Path control coordinates change canonically, endpoints and ID stay fixed; visible ROI includes intended bend/curve, not just bounding-box change; cancel restores before; reload keeps edited path. Unsupported routing recorded as gap. |
| C08 Styles/label | Edge selected | Use real menu color, solid/dashed, width, both end styles; type multiline label; move label if signed supported | Contract fields and actual paint both change; dashed gap ROI and width cross-section measurable; start/end arrow direction checked; label actual text survives reload, line remains visible. Menu selection state is not sufficient. |
| C09 Cancel | Snapshot before create/reconnect/path change | Escape or actual browser pointercancel while held | No new canonical object/revision caused by cancelled gesture; previous endpoint/path unchanged and preview/cue removed. New gesture works, proving no stuck capture. Existing unrelated events excluded using operation attribution. |
| C10 Undo/redo | Committed single gesture | Actual Cmd/Ctrl+Z once, redo once | Exactly one undo restores semantic before and one redo restores after, same edge ID; no extra undo for geometry versus relationship; reload saved redo result matches. |
| C11 Persistence | Styled attached/free edge and edited path | Wait saved; GET canonical; reload; second owner context opens board | All relationship/path/style/label fields equal normalized after snapshot; actual rendered endpoints/pixels remain correct. Saving spinner alone is not persistence. |
| C12 Permission | Authenticated same-org viewer, owner edge | Attempt toolbar/shortcut, drag creation and endpoint editing; submit equivalent valid real operation | UI noneditable, no operation POST from gestures, explicit API denial, head/snapshot unchanged. Owner re-read confirms no writes. Cross-tenant visibility is separately checked with actual outsider. |
| C13 Zoom/narrow | Zoom 0.5/1.65/2 with nonzero pan; then 390px viewport | Create and reconnect through visible controls at each transform | Inverse-coordinate oracle exact within above tolerance; handles/menu fit viewport and remain hit-testable; no horizontal chrome scroll; screenshots before and after explicit fit distinguish manual fit from auto-fit. |

## Fail-Closed Reporting

## Required Scope Extension (Implemented Locally, Full Matrix Not Run)

The user explicitly includes path handles, durable width and label position in this round. C07-C08 are required, not deferrable P1. C14-C21 below are also required. Persisted field names, units, limits and legacy defaults now refer to the locally implemented canonical contracts in `packages/contracts/src/whiteboard-document.ts`; core path resolution is `packages/whiteboard-core/src/connector-path.ts`. Do not copy a second schema into tests. Local implementation does not mean full matrix execution, merge or CI green; missing required behavior is a failing case, not a passing gap.

| ID | Given | When (real input) | Then / required evidence |
| --- | --- | --- | --- |
| C14 Path-type controls | Straight, elbow/bent and curved connectors separately | Straight: drag endpoint, and move whole line with both ends free. Elbow/curve: drag actual path handles. Repeat at nonzero pan and zoom 0.5/1.65/2 | Each type has its signed operable controls. Straight stays collinear with endpoints and exposes no curvature/middle-deformation handle. Elbow/curve path coordinates persist while bound endpoints stay fixed; colored path follows pointer before up. One undo restores each entire gesture and redo restores it. All three types remain required, without demanding impossible straight deformation. |
| C15 Durable width | Nondefault width selected on isolated horizontal and diagonal paths | Change width through toolbar, reload, open another independent browser | Contract width survives; perpendicular pixel cross-section differs from thin baseline and equals renderer width convention within 1 physical pixel after DPR/zoom normalization; avoid arrow/label/join ROIs. Compare actual opaque/translucent edge profile, not bounding box or menu preview. |
| C16 Label position | Nonempty label on long path with blank space | Drag label along each path at pan/zoom combinations; reload and second browser | Signed label position representation persists, maps to correct world/path location and visible text center within 2 CSS px; label remains attached after endpoint move and path edit. One undo/redo covers position only; line geometry is unchanged when only label moves. |
| C17 Copy/export compatibility | Attached/free edges with all three paths, width, moved label | Real copy/paste and duplicate; real standard/portable export and import on a fresh board | All new connector fields survive each supported route. Copied endpoint IDs remap to copied nodes; outside-selection endpoints follow signed policy. Label position and width render identically, excluding expected translation. No silent dropping, old-record defaults tested, malformed fields rejected. Unsupported format must explicitly reject before publication; cannot satisfy a required roundtrip with rejection. |
| C18 Independent browsers | Two independently launched browsers with real owner sessions, initially same saved board | Browser A edits path/width/label; B observes; then B reconnects endpoint while A moves target | Both converge to identical head and canonical values plus correct rendered geometry. Use separate browser processes; explicitly report engine names/versions. Include Chromium and a second supported engine if the requirement means cross-engine; two contexts alone do not prove dual-browser coverage. Conflict expectations await signed policy; no assumed last-writer rule. |
| C19 Target deletion | Attached edge and undoable target | Delete/soft-delete target with signed keep-free or delete policy; undo once, redo once | No dangling invalid target IDs; keep-free uses last visible world endpoint, delete removes edge atomically as signed. One undo restores nodes/edge/bindings/path/style/label; remote second-browser deletion also clears live candidate safely. |
| C20 Locked/revoked during gesture | Locked source/target, commenter; separate editable gesture in flight | Try creation/reconnect, then owner revokes permission or archives board during drag | Signed locked-target behavior enforced; commenter cannot mutate; revoked/archive pointerup emits no illegal successful write, authoritative head unchanged, pending preview cleared. API denial uses exact expected endpoint/status and preserves strict pageerror handling. |
| C21 Creation boundaries | Source A and blank canvas, then two valid targets | Drag A to blank; zero-distance down/up; two sequential explicitly reselected creation gestures | Free endpoint created only by a valid nonzero gesture; zero-distance leaves snapshot unchanged. Each valid gesture adds exactly one connector, returns to selection, and no extra connector appears on intervening clicks. |

Schema review prerequisites: path discriminant/control point units, width units/defaults, label position encoding, binding versus free-point exclusivity, import/backward compatibility defaults and size limits, copy ID-remap policy, delete/locked policy, and conflict behavior. Required behavior must be reflected in the canonical contracts before candidate automation implementation.

Schema authority is `packages/contracts/src/whiteboard-document.ts`; [contract audit](connector-figjam-contract-audit.md), [geometry plan](connector-figjam-geometry-plan.md), and [existing surface domain](../contracts/board-fabric-surface/domain.md) supply design/history context, not independent wire schemas. Route/control/width/label assertions use the implemented canonical contract and must verify renderer plus copy/export compatibility. The human approved development; this document does not rewrite signoff status or claim full acceptance.

Every declared case has nonempty distinct checks with PASS/FAIL; gaps separately listed. Exit nonzero for any assertion/error, absent API readback, missing required PNG, hash mismatch, timeout or unsupported required feature. Aggregate actual executed/pass/fail counts even for failed children; do not report all coverage complete while hardware, unsupported path/style, viewer or persistence cases are absent. Network capture redacts authorization and never archives state/password/activation data.

False-green examples prohibited: seeded connector proving creation; screenshot-only live following; menu option proving actual paint; attachment inferred from proximity; production helper both generating and verifying geometry; initial snapshot mistaken for latest head; canvas-wide ink changes from cleared selection; lenient endpoint tolerance masking incorrect anchor; owner used as viewer; reload without real saved/readback.

## Full Required Command (Not Implemented)

The script now exists with a real pointer subset dispatch, but the following full-scope command remains a design target, not completed verification. Services and explicit authorized owner/viewer states are prerequisites; no password reads or automatic Docker/server startup.

```bash
node scripts/local-session/board-connector-acceptance.mjs --base http://127.0.0.1:3317 --api http://127.0.0.1:3320 --storage-state /private/tmp/owner-state.json --viewer-storage-state /private/tmp/viewer-state.json --commenter-storage-state /private/tmp/commenter-state.json --second-browser chromium --out /private/tmp/connector-fresh-run
```

Proposed report: {status: draft|not-run|pass|fail, sourceSha256, boardId, results:[{id,name,ok,measurements,screenshots}], errors:[], gaps:[], executedChecks, passedChecks, failedChecks}. Add actual paths only after execution. Proposed CI subset uses provisioned local real services and isolated organizations, not mocked API.

All C01-C21 are required for this user-confirmed round; none of path handles, width, label position, compatibility or dual-browser convergence is deferred. Extra FigJam parity such as style memory/bulk style is a separately named optional gap unless adopted by signed scope. A denied viewer operation must not advance head. Creation/cancel is one gesture transaction and one undo step, not separate relationship/geometry writes.

## Real Pointer Subset Lane

```bash
node --import tsx scripts/local-session/board-connector-acceptance.mjs --pointer-subset --storage-state /private/tmp/wsx-board-ux-authorized-session.json --out /private/tmp/connector-fresh-subset
```

This dispatches the shared strict Sticky browser harness with `--connectors`. It runs nine Sticky setup/regression
checks plus seven explicitly partial Connector checks, not twenty-one completed requirements. Nodes are created
through actual UI; the separate magenta M07 fixture edge is never counted as Connector creation. The new tested
edge is created by real pointer down/move/up. Exact CDP comments cancellation correlation, authorized session,
actual API export readback, source hash freeze and owned archive/delete/fresh-404 cleanup remain mandatory.
The route field is checked on canonical records; renderer-only `start/end` fields are not invented in the API.
Endpoint screen positions use independent world/cardinal-anchor trigonometry and real handle DOM bounds.

Runs 1 and 2 exposed harness mistakes (renderer-only endpoint fields and a nominal empty drop point actually
inside the fitted target), which were corrected without changing production or increasing tolerances. Run3
(`/private/tmp/wsx-connector-pointer-run3/report.json`) passed real C01 creation, C04 detach and C09 Escape
cancel but failed required C10 keyboard undo: Ctrl/Meta+Z did not restore the binding. This remains a real
required defect until the owner implements the shortcut and a fresh run proves it.

Run4 proved one detach transaction through real Undo/Redo buttons, recorded only as a partial button atomicity
check; this does not satisfy the C10 keyboard requirement or erase run3's failure. Runs4/5 then timed out on
a wrong route-preview oracle: `board-connector-live-path` is creation-only, whereas edits preview through
Fabric. Run5 `elementFromPoint` proved both curve handle centers physically hit their own controls, so there
is no evidence of a toolbar obstruction in that case. The corrected candidate checks actual held handle
movement and canonical zero-write before capturing Fabric, rather than requiring a creation-only SVG.
All these attempts failed overall and cleaned their owned boards to fresh 404. They are not suite passes.

Run6 still failed the actual C10 shortcut after the first keyboard implementation. Run7
(`/private/tmp/wsx-connector-pointer-run7/report.json`) retained the same failure and recorded an independent,
observation-only `/private/tmp/wsx-connector-pointer-run7/connector-keyboard-diagnostic.json`: the active element
and real Meta+Z key target were `BODY`, `inEditor` was false and the event had not already been prevented.
Real connector pointer handling prevented the normal focus transition, so the new keyboard containment guard
ignored a shortcut after an actual canvas interaction. The harness did not focus a hidden control to manufacture
a pass. The owner received this counterexample before a focused production fix; any new success must come from
a fresh run. Run7 also passed the new C01 independent black Fabric centerline pixels at three points; the
magenta seeded fixture cannot satisfy the black-pixel criterion. Run7 remains 12/13 overall, not green.

Run8 stopped at the stricter C01 pixels: the new black edge and seeded magenta edge had identical anchors,
path and layer, so the fixture could cover the tested path. C10 was not executed in run8, neither passing
nor failing anew. The candidate now creates a distinct A-top/B-left path, while the M07 fixture remains
A-right/B-left. This removes the oracle ambiguity without changing production color, stacking or tolerances.

### Run9 Frozen-Source Pointer Subset Pass

`/private/tmp/wsx-connector-pointer-run9/report.json` exited 0 with sixteen executed/passed checks:
the nine Sticky prerequisite/regressions and **seven partial Connector cases** C01/C04/C09/C10/C07/C16/C11.
The report separately records `executedConnectorChecks: 7`, `passedConnectorChecks: 7`, twenty-one explicit
partial/not-run statuses and `coverageComplete: false`. All eighteen PNGs were recorded; unexpected and
HTTP errors were zero, source/application hashes stable, and owned board
`e12d1430-9da9-43b7-9009-a8fb5808a5e1` was archived/deleted/freshly read as 404.

The observation-only keyboard diagnostic shows `SECTION`, `collaborative-editor`, `inEditor: true` for
the real Meta+Z event after accepted pointer input; the harness did not focus a control. One actual keyboard
undo restored the detached binding and Shift redo restored the free point. Curve held preview control motion
matched the real pointer while canonical stayed unchanged; three independently computed cubic positions each
contained sixteen black Fabric pixels, excluding the magenta fixture. Canonical width 7, multiline label,
one dragged label position and the saved reload were retained. These are the tested versions and partial
matrices only, not complete C08/C14/C15/C16 or full C01-C21.

A subsequent independent real-Fabric RED exposed a preview/canonical revision collision outside this subset.
It was later repaired using local appearance identity with independent GREEN evidence; run10 below is the
fresh post-repair subset. Preserve run9 and the RED history: run9 itself did not resolve the later defect
and does not prove source changed after its hashes were captured.

### Latest Run10 UI Subset

After the real-Fabric preview identity fix and independently red/green compact-label fix, a fresh
`/private/tmp/wsx-connector-pointer-run10/report.json` passed the same sixteen-check subset (nine Sticky
checks plus seven partial Connector cases), with eighteen PNGs, zero unexpected/HTTP errors and stable
application hashes. Owned board `1d88ea35-d6c0-4bfc-83d1-5dcbb2bb0936` was verified, archived, deleted and
freshly read as 404. The actual committed/reloaded screenshots were viewed: width 7, multiline moved label
and compact white label background are visible; the old path-wide white strip is absent. The independent
reviewer also viewed held curve, committed label and reload. The overlapping blue circle/rectangle are an
intentional M05 overlap-creation fixture, not evidence of a new silhouette regression. Run10 is current-source
subset evidence, not a new real-browser collision/revocation/dual-free/elbow matrix or full C01-C21 pass.

### Highest-Risk Next Lanes

1. C09/C18/C19/C20: two independent browsers; A holds an endpoint/path drag with zero canonical writes,
   B performs actual target update/lock/delete, then A observes latest authority and releases or cancels.
   Compare latest API/head, actual controls and independent Fabric ROI to current authoritative geometry.
   Separately provision real viewer/revocation/archive lanes with exact expected API denials, not owner-only
   readonly controls. Include the reproduced revision collision and prevent stale ink/illegal successful writes.
2. C04/C14: detach both endpoints through actual handles, drag the actual body hit region by a measured CSS
   delta, assert zero held writes and equal inverse-transformed deltas on both absolute points. Path points
   translate exactly once; width/label remain unchanged. Actual keyboard single undo/redo, reload and nonzero
   pan/zoom remain required, not inferred from single-end detach.
3. C07/C14: select elbow through the real menu and drag each visible guidepoint. Independently measure an
   axis-aligned polyline and actual path pixels, not curve/bounding-box substitutes. Test held zero-write,
   one commit, Escape/native cancel restoration, single undo/redo, reload and label following at pan/zoom.

The seven candidates are C01/C04/C07/C09/C10/C11/C16 subsets; each retains its incomplete matrix in report
gaps. Actual path raster geometry, thickness pixels, full styles, every routing control, all pan/zoom variants,
reconnect/following, permissions, export/copy, independent browsers and C17-C21 remain required. Default
inventory reports zero executed checks and exits 2; `--plan` exits 0 for inventory only, never acceptance.

Next execution schedule: [position and capability matrix](connector-matrix-acceptance-plan.md). Contract/focused tests and the seven partial pointer cases have actual evidence above; do not describe them as all unexecuted. Remaining full-scope work includes compatibility roundtrips, all routing/position controls, independent browsers/permission races, zoom/narrow variants, deliberate oracle failure checks and fresh frozen-source reports. The default full-suite command remains unimplemented; completed subset commands do not satisfy it. The new matrix's screenshot paths remain pending until actual execution and hashes are recorded.
