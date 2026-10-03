> Historical snapshot, 2026-10-02. Not current approval, runtime acceptance, or feature status. See README.md and issue #5001.

# Sticky Mural-Inspired Acceptance Draft

Status: required test standard with executable partial browser evidence recorded below. User-approved fixed-shape text fitting is implemented; full S01-S18 completion is not claimed.

## Reference and Product Boundary

Official [Mural sticky lesson](https://learning.mural.co/lessons/add-create-and-customize-sticky-notes)
describes shape/color choices and dragging the chosen note onto the canvas. Its shortcuts include double-click,
nearby style inheritance and Tab to add notes; it recommends navigation zoom rather than changing the default
note size merely to read text. These are references, not automatic WorkspaceX scope requirements.
The [Mural sticky API](https://developers.mural.co/public/reference/updatestickynote) exposes text, geometry,
rotation and formatting; it does not prove a particular browser IME, resize or undo behavior.
The [Mural area lesson](https://learning.mural.co/lessons/organize-content-into-areas) is a useful grouping reference,
not a reason to re-enable Frame creation hidden by the current product request.

Classification: **P** = existing user-confirmed product rule; **R** = regression acceptance protecting it;
**N** = new behavior requiring product/design confirmation before implementation. No new wire schema is defined
here; geometry/appearance/text use contracts and whiteboard-core. Current source existence is not completion.
This round preserves single-shot creation; it does not import Mural Tab continuous-create or nearby-note
inheritance. Optional followup candidates are explicitly outside S01–S18 until confirmed.

## Harness and Independent Evidence

Use explicitly authorized owner/viewer storage-state paths, real locally provisioned API and a fresh board.
No secret-file reads, fake claims, Docker/server startup or external Mural mutation. Record source SHA/hash,
engine/version, CSS viewport, DPR, canonical snapshot/head before/after, exact pointer coordinates, screenshots
and observed save receipt. Nodes/edges used solely as fixtures may be seeded through validated API and must be
labelled; a seeded Sticky never counts as successful user creation. No Fabric/Fiber mutation as user input.

Independent coordinate oracle: screen = canvas CSS origin + pan + zoom * world; rotated corners/cardinal
anchors computed from canonical top-left rotation origin and local coordinates without calling production geometry helpers. Endpoint
world comparisons use 0.01 world units; visual centers use 2 CSS px. Declared quantization must follow the signed
rule, not a tolerance increased after failure. Pure viewport pan leaves canonical coordinates unchanged.
For pixels use isolated interior/edge ROI excluding text/selection/toolbar; selected CSS or SVG alone does not
prove actual canvas color/shape. Normalize sampling by DPR. A circle has clear corner exterior and filled center;
rectangle/square dimensions must agree with canonical aspect and actual silhouette. Avoid anti-aliased edge
samples for exact interior color checks. Color, shape and text are independent assertions.

Wait actual live preview plus two animation frames for held-pointer evidence; canonical stays unchanged until
commit. Wait observed saved/readback rather than sleep alone. API persistence and reload are mandatory where
specified. Capture before, held/live and committed/reloaded PNG with signature, bytes and SHA.

## Given / When / Then Matrix

| ID / Class | Given | When (real input) | Then / evidence |
| --- | --- | --- | --- |
| S01 Picker / P | Empty editable board | Open Sticky; choose each available color and square/rectangle/circle | Swatch selected state matches choice; each shape preview uses that exact color and true silhouette, not text-only or generic framed icon. Dock reflects last choice after closing/reopening. No canonical Sticky is created by menu selection alone. |
| S02 Once / P | Selected nondefault color+shape | Click a clear visible canvas point, then another without reselecting tool | Exactly one new Sticky from first click; correct color/variant/placement; returns Select and second click creates none. Next explicitly reselected gesture creates exactly one more. API/readback and canvas pixel ROI agree. |
| S03 Existing overlap / R | Existing Sticky/Shape at intended point | Arm Sticky and click center of existing object | Exactly one new note at inverse-screen world position; old object's geometry/text unchanged. Old hit target cannot swallow creation; completed tool returns Select. Repeat through menu choice with existing object selected, verify no stale toolbar covers picker. |
| S04 Drag/drop / P | Dock/picker selected color+shape | Actual pointer drag chosen preview from toolbar onto clear canvas | Exactly one note at drop point, appearance matches chosen preview, Select afterward; no duplicate from subsequent click. Use native browser drag generated by pointer movement; dispatching DragEvent with prefilled DataTransfer is separately labelled protocol-only, insufficient for this case. |
| S05 Cancel / R | Snapshot/head before create drag | Escape while held; separate drop outside board; separate pointercancel/lost-capture | No created note/geometry change from cancelled action or outside-board drop; preview clears and a new gesture works. Native HTML drag cancellation, pointercancel and protocol-only DragEvent are distinct evidence, not interchangeable. Existing unrelated receipts excluded by operation attribution. |
| S06 Inline text / P+R | Newly created note, editable role | Actual double-click/text editor activation; type multiline Chinese/Latin and commit through actual blur/command | Text appears inline, not a remote inspector-only editor; exact unicode/newlines preserved in canonical and reload. No extra note/duplicate or transform caused by editing. Basic text typing is required; IME behavior is separately S07. |
| S07 IME / R | Inline editor active, selected note | Compositionstart/update, Enter while composing, compositionend and final commit | Composing Enter does not prematurely submit/create; final composed value persisted once without truncation/duplication. Synthetic composition tests are labelled browser integration, not native OS IME proof; native macOS IME remains explicit manual gate until actually executed. |
| S08 Long text / P+R | Square, rectangle and circle separately; fixed sizing | Enter long wrapped text, multiline and one long unbroken word | User-approved behavior: preserve shape size and full text, render-only font fit down to actual minimum typography token, then editor scroll permits tail editing. No unexpected circle aspect expansion or neighbor overflow. API geometry and actual layout agree; no truncation or canonical font write merely from fit. Legacy records follow migration/compatibility policy rather than implicit metadata rewriting. |
| S09 Resize / R | Fixed-size rectangle and proportional square/circle, short text | Drag actual visible corner/side controls | Allowed dimensions/aspect follow core sizing policy, text remains anchored/padded, canonical changes only on completion; one undo restores before. Forbidden controls absent/nonoperable under auto-size/auto-height policy. Test controls through hit points, not imperative Fabric scale. |
| S10 Rotate / R | Asymmetric colored rectangle at nonzero pan | Drag actual rotation handle to a measured angle | Live silhouette/handles/text rotate together; canonical rotation matches independent angle/oracle within declared quantization; no skew encoded. Toolbar does not cover handle. Release commits, undo restores. |
| S11 Live chrome / P | Selected note and connector fixture to another node | Hold actual drag, resize and rotation at intermediate points | Four connection handles/control points and floating menu remain positioned against current preview, not old canonical frame. Connector endpoint follows live before pointerup and opposite endpoint stays fixed. Canonical remains unchanged while held. Existing-edge fixture does not count as connector creation acceptance. |
| S12 Undo/redo / R | Each completed create/move/resize/rotate/color/shape gesture; separate inline text edits | Actual Cmd/Ctrl+Z once then redo; text test records actual debounced/native history granularity | One step restores semantic before/after for each object gesture; no split geometry/appearance transaction. Text follows current debounced-live/history and native editor undo, not an invented whole-edit-session single step. Esc ends editing and flushes; it is not text rollback. Object/relationship identity follows signed core history semantics, not an invented same-ID rule for structural redo. Remote edits yield explicit conflict, not silent overwrite. |
| S13 Persistence / R | Saved nondefault note with text/transform and connector fixture | GET current canonical/head; reload | Exact supported appearance/text/geometry preserved; actual canvas shape/color/text/connector endpoint correct after reload. Spinner/DOM menu selection not sufficient. No stale pre-save export accepted. |
| S14 Two browsers / R | Two independently launched browser processes with authorized sessions on same board | A creates/edits/moves; B observes, then edits note text | Both converge on canonical/head and visible geometry/text; viewer context not reused as owner. Report engine names/versions and whether cross-engine or same-engine processes; two tabs alone cannot prove two browsers. Conflict behavior follows signed core policy. |
| S15 Viewer / R | Real same-org viewer and owner snapshot | Try dock, shortcut, double-click, drag, inline edit, transform; submit equivalent valid real operation | No UI mutation operation accepted, API gives explicit denial, authoritative canonical/head unchanged; owner re-read confirms. Expected denial exact endpoint/status recorded; never suppress all 4xx. Missing viewer state is a missing required case, not pass. |
| S16 Locked/race / R | Locked note; separately editable note midgesture | Try edit/transform locked note; owner locks/deletes target or revokes permission before up | Locked mutation blocked; stale preview cannot resurrect/delete/overwrite target. Commit observes latest authority, rejects/clears safely and permits next valid gesture. API/current canonical prove outcome. Signed behavior for selecting/moving attached edges is independent. |
| S17 Zoom/DPR / R | Fresh board at zoom 0.5/1.65/2, nonzero pan, DPR1 and2 | Create/drag/edit/resize notes through actual controls; wheel pan/pinch event | Inverse-screen oracle correct, controls/menu attached and operable; viewport movement does not mutate canonical. Shapes do not clip due bitmap size. Hardware Trackpad remains manual unless actual device test performed. |
| S18 Narrow/menu / P+R | 390px viewport, existing selected object, Sticky armed | Open colors/shapes, select every visible option and drag/create | Menu within viewport, root horizontal scroll remains zero, each button center elementFromPoint belongs to expected target; old toolbar/handles do not overlay. Color+shape visible despite selection state, dock usable. Bounds-only assertion does not satisfy this case. |

## Open Design Choices and Out-of-Scope Parity

S05 outside-board drop follows the existing cancellation/no-product rule.
S08 fixed-size/render-only font fit and editor overflow scrolling now have explicit user approval; legacy
compatibility still follows the contract. S07 includes a native
OS manual gate, not a false automation claim. Nearby-style inheritance, Tab-to-next-note, sticky stacks, voting,
tags, rich-text/HTML parity and area management are not adopted by this standard.

## Fail-Closed Report and Candidate Execution

Every S01–S18 has distinct measurements and PASS/FAIL/not-run/manual-required. Required unsupported behavior
is a failure or unresolved design gate, not a passing gap. Report errors without token/session/password;
pageerror/unexpected console/requestfail fail the run. Expected planned injection/cancellation needs exact
method/URL/action window/cause and a separate array; no blanket abort suppression. Source hashes before/after,
required PNG hashes, actual executed/pass/fail counts and cleanup outcome are mandatory. Partial run exits
nonzero when mandatory cases are absent; software-suite green and hardware/manual completion remain separate.

Planned script: `scripts/local-session/board-sticky-acceptance.mjs` (not implemented/run).
Candidate CLI after standard review:

```bash
node scripts/local-session/board-sticky-acceptance.mjs --base http://127.0.0.1:3317 --api http://127.0.0.1:3320 --storage-state /private/tmp/owner-state.json --viewer-storage-state /private/tmp/viewer-state.json --out /private/tmp/sticky-fresh-run
```

Implementation order: picker/create/overlap/native drag; inline/composition/layout; real transform/chrome/edge;
undo/persistence; separate-process cooperation/permissions/races; zoom/DPR/narrow; deliberate wrong-color,
wrong-coordinate and missing-PNG negative checks proving failure. No source helper used as both action and
oracle. Do not attach invented execution evidence to this draft.

## Actual M0 Evidence (2026-10-01)

`board-sticky-acceptance.mjs` now implements a nine-check subset M01–M09, not all S01–S18.
Executed against the already running local web/API 3317/3320 with an explicitly authorized state;
no password reads, no Docker/server startup. Latest fresh evidence:
`/private/tmp/wsx-sticky-m0-run5/report.json`.

Run5 exited **1 / FAIL** despite nine behavior checks passing. It measured actual blue canvas RGB,
native browser dock drag/drop, existing-object overlap creation, single-shot/inline saved text, armed Esc,
held-pointer handle/menu/seeded existing-edge pixels, API/readback/reload and 390px actual hit targets.
Eight PNG files passed signature/length/SHA checks. Entry and classifier hashes remained stable.
Its temporary owned board was archived with current lifecycle revision, permanently deleted, and a fresh
API GET returned404. No console/pageerror/HTTP failures were recorded.

The strict gate retained three comments GET `ERR_ABORTED` as failures. Browser-side observed AbortSignal
and React DEV StrictEffects cleanup stacks existed, but Node request lifecycle events were delivered after
the browser rejection and did not uniquely overlap; each cycle also had a concurrent successful same-URL
request. The classifier correctly refused ambiguous/absent lifecycle pairing. No time tolerance was expanded
to manufacture a pass. Exact browser/network request identity instrumentation is the next evidence task.
The six pure classifier tests passed, including two concurrent same-URL requests with one signal exempting
neither. Run5 is not an M0 green result and cannot establish full S01–S18 completion.

Remaining required software/manual coverage is listed in the report gaps: all appearance combinations,
native drag cancellation, IME, signed long-text fitting, resize/rotation, transform-following variants,
undo/redo, independent-process collaboration, real viewer/locked/race and complete zoom/DPR matrix.
`coverageComplete:false` and `requiredSuiteComplete:false` remain explicit.

### Latest Run7: M0 Subset Pass, Not Full Acceptance

Fresh `/private/tmp/wsx-sticky-m0-run7/report.json` exited0 with `--m0-only`: nine behavior checks
passed, errors empty, eight PNG signatures/lengths/SHA verified, entry/helper source hashes stable, and its
owned fixture completed archive/permanent-delete/fresh GET404 cleanup. The ten pure classifier tests passed.
This is a **nine-check subset pass**, not S01–S18 completion; all above required gaps remain explicit.

Run6 demonstrated that Playwright `request.timing().startTime` for very-early cancelled comments requests
is0, while successful requests have epoch timestamps. Zero is not used as a valid network start and no timing
tolerance was widened. Run7 instead observes native fetch through a uniquely named dispatch function whose
name carries fetchId, records AbortSignal cleanup/rejection with that ID, and reads Chromium CDP
Network.requestWillBeSent initiator + Network.loadingFailed requestId. It changes no request headers/body/URL.
Expected cancellations require exact network requestId/fetchId, one matching genuine aborted signal with
editor effect-cleanup stack, canceled=true, exact comments GET/error reason, and matching Node/CDP failure
counts. Concurrent same-URL requests with missing/duplicate IDs or mismatched counts fail closed.
Console/pageerror and unrelated failed requests remain strict; this Chromium-specific instrumentation is not
cross-engine evidence.

### Long Text Run11 and Independent Browsers Run12

`/private/tmp/wsx-sticky-long-run11/report.json` exited0 with `--long-text --m0-only`, twelve checks passed
(nine M0 plus square/rectangle/circle L01–L03), errors0, seventeen PNG files checked, five relevant application
source files plus entry/helper stable, and owned-board fresh GET404 after cleanup. Each shape retained3565
mixed Chinese/English/unbroken-word characters, exact fixed geometry, actual caption minimum token14,
editable tail via real wheel scrolling, and values after zoom/reload. Resize and rendered overflow-clipping
pixels remain unexecuted. Control+End alone moved the caret but did not scroll on reopen; the report records
that fact and tests actual wheel access rather than claiming shortcut scrolling.

`/private/tmp/wsx-sticky-two-run12/report.json` actually launched two independent Chromium processes
(151.0.7922.34 each, same explicitly authorized owner identity). A typed a real text edit; B observed it,
then moved the note through real pointer input; A observed matching geometry and both full DOM mirrors
converged. B01 and nine M0 behavior checks passed, but the run correctly exited1 because the real header
emitted61 duplicate React child-key warnings for the same user in two sessions. No warning was ignored.
The fixture was deleted and fresh GET404 verified. Header-presence implementation repair and a fresh rerun
are required before this becomes green. Simultaneous draft competition, another user and cross-engine
coverage remain explicitly absent; two processes alone are not full collaboration acceptance.

### Visual Counterexample and Run14 Freeze Failure

Main-session screenshot review found that run11's circle editing viewport still allowed text outside the
circle. Its twelve behavior checks did **not** prove visual S08 completion; historical reports remain intact.
The implementation owner subsequently bounded overflow editing to the shared inscribed rectangle.
New circle checks independently compare all textarea viewport corners against canonical circle geometry and
sample screenshot pixels: nonblank dark glyphs inside, zero dark glyphs in clear outside-circle corners, at both
initial and zoomed scroll tail. They do not use the production layout helper as oracle.

`/private/tmp/wsx-sticky-expanded-run14/report.json` executed fourteen behavior checks, all passed, errors0,
seven exactly attributed CDP cancellations, and owned-fixture archive/delete/fresh GET404 cleanup. Its zoomed
circle viewport corner ellipse values were about0.538 (inside1);2074 dark glyph pixels existed inside, zero
outside. Two independent browsers converged, and the synthetic-composition integration case verified that
an uncommitted local draft survives a peer's real text commit; existing `commitEdit` conflict handling refuses
overwriting the peer canonical text and exposes the preserved local draft. This is not native OS IME evidence.

The run still correctly exited1: the editor and ThinkingInput source files changed during execution, so
application source freeze failed. This is **not** a green fourteen-check result. A coordinated stable-source
rerun is required; thresholds/error gates were not relaxed. Real viewer, native IME, actual resize/rotation,
complete zoom/DPR and additional appearance coverage remain outstanding.

### Run15 Navigation Failure

`/private/tmp/wsx-sticky-expanded-run15/report.json` exited 1 before any behavior check: the first board
document navigation exceeded the existing 30-second load deadline. Its document `net::ERR_ABORTED` remained
an unexpected error, not an allowed comments cancellation. The owned fixture was verified, archived at
lifecycle revision 1, deleted, and independently read back as 404. Source observation now also includes the
new direct DOM dependency `use-sticky-font-revision.ts`. This failed attempt provides no new behavior pass;
runtime readiness must be established before another frozen-source run. No timeout or error gate was relaxed.

### Stable Run16 Subset Evidence

After a separate non-acceptance `/login` prewarm returned 200 in 1.61 seconds, the unchanged 30-second
navigation deadline succeeded. `/private/tmp/wsx-sticky-expanded-run16/report.json` exited 0 with
`status: subset-pass`, fourteen executed/passed checks, zero unexpected errors, and `coverageComplete: false`.
All nine directly relevant application files and the entry/helper source hashes stayed stable. Seven comments
cancellations had exact CDP request/fetch attribution and matching seven Node failures; no blanket abort
exception was added. All 22 screenshots independently passed PNG signature, byte length and SHA checks.
The zoomed circle tail ROI was also actually viewed: the scrolling text viewport and visible final text stayed
inside the circle. B01 used two independently launched Chromium processes; B02 confirmed the existing
preserve-draft/refuse-conflicting-commit policy, not last-writer semantics or native OS IME.

Owned board `fbd75928-0c8b-4733-a0af-74011d01363e` was owner-verified, archived at lifecycle revision 1,
deleted, and freshly read back as 404. This proves the fourteen-check subset only. Real viewer permissions,
readonly full-text viewing, native IME, actual resize/rotation, complete DPR/zoom and all S01-S18 requirements
still need their own evidence; the full suite is not green.

### Run17 Candidate Checks (Historical Not-Run State)

`--readonly-view` adds R01 after the three long-text checks: actual Eye click opens a readonly, non-disabled
full-text textarea; native wheel reaches its tail, real selection exposes the complete text for copying,
closing preserves the complete API snapshot, and no command/operation POST is dispatched during viewing.
The currently authorized owner can prove this UI behavior only, not real viewer authorization or clipboard
permission. R01 has passed syntax checking but has no browser result yet; it does not inherit run16 evidence.
Actual resize/rotate and Connector C01-C21 remain separate planned lanes, not checks counted by this flag.
The first attempted R01 run, `/private/tmp/wsx-sticky-readonly-run17/report.json`, failed at the initial
identity readiness GET with API port 3320 `ECONNREFUSED`, before board creation or any behavior check.
It contributes no R01 pass. The source freeze was released immediately; no fixture was created.

`--transforms` separately adds candidate T01: real canvas bottom-right resize control, real bottom rotation
control, authoritative size/rotation and full-text readback, then actual transformed DOM viewport corners
independently inverse-rotated into canonical circle coordinates. It takes resize/rotation/tail screenshots and
checks projection does not rewrite geometry. This is syntax-checked but not run. Rotated raster glyph clipping
is still a distinct gap; corner containment is not reported as pixel proof. Connector candidate inventory lives
in `scripts/local-session/board-connector-acceptance.mjs`; its `--plan` verifies all 21 unique cases from the
existing connector standard, reports zero executions and `not-run`, and default invocation exits 2.

### Run18 R01/T01 Evidence

`/private/tmp/wsx-sticky-m0-run18/report.json` exited 0 with fourteen executed/passed subset checks:
M01-M09, L01-L03, T01 and R01. This is a different fourteen-check selection from run16, not an increase
to twenty-eight unique cases or full S01-S18 completion. There were zero unexpected errors and zero HTTP
failures; all observed application/entry/helper hashes stayed stable. The 23 PNG signatures, byte lengths
and SHA hashes were recorded. Owned board `3ba51919-a922-46a6-87b6-aa1ff51d93a1` was owner-verified,
archived, permanently deleted, and freshly read as 404.

T01 used actual Fabric resize/rotation controls, preserving all 3565 characters; the final circle was
229.556789 by 229.556789 world units at -30 degrees. Independently inverse-transformed DOM editor corners
had ellipse values near 0.6255, inside the circle. This is DOM containment, not rotated glyph raster proof.
R01 used the Eye control, a readonly/non-disabled textarea, actual wheel tail scrolling
(`scrollTop: 1620`, `clientHeight: 656`, `scrollHeight: 2276`), complete selection and zero operation POSTs.
It proves owner readonly-view UI, not viewer permissions or granted clipboard access. The original R01
screenshot was taken after select-all and may show the beginning: the next candidate separately captures
the tail before selection and names the selection screenshot accurately. The next T01 candidate also asserts
the computed transform origin explicitly; these strengthened assertions do not retroactively belong to run18.

S08 fixed-shape long-text fit/scroll, S09 circle resize and S10 circle rotation now have partial evidence.
Complete shape/content/angle matrices, rotated raster glyph containment, real viewer permissions, native
OS IME, full DPR/zoom coverage and all S01-S18 remain required, not passing.

### Run19 Strengthened Subset Evidence

`/private/tmp/wsx-sticky-m0-run19/report.json` exited 0 with the same fourteen M01-M09/L01-L03/T01/R01
checks, 24 recorded PNGs, zero unexpected/HTTP errors and stable entry/helper/application hashes. T01 now
explicitly asserted the computed transform origin `0px 0px`; R01 captured actual scrolled tail before
select-all and then a separately named selection screenshot. Owned board
`9595803c-3eb7-46d8-a388-842d30d324af` was verified, archived, deleted and freshly read as 404.
This supersedes the strengthened assertion gap in run18, not the rest of S01-S18. Reports remain separate
frozen-source observations. A later Connector preview revision-collision fix needs its own verification;
run19 is not retroactively evidence for later production source.

### Latest Run20 UI Subset

After the Connector preview appearance-identity and compact-label fixes, a new frozen-source
`/private/tmp/wsx-sticky-m0-run20/report.json` passed fourteen checks, recorded 24 PNGs and retained zero
unexpected/HTTP failures and stable application hashes. Owned board
`a4c73315-0884-45ec-bb50-c47ac265c2cc` was archived/deleted/fresh-404 verified. The circle zoom-tail and
readonly-full-text-tail images were actually viewed; the latter visibly includes line 28 and `END_EDITABLE`.
The rectangle tail behavior passed, but that fixture's paper top is outside the viewport, so this image is not
selected as a complete-shape human presentation. A new `--presentation` candidate adds P01/P02: actual
middle-button pan centers the already tested rectangle/circle without canonical changes, actual editor
navigation/wheel reaches the complete tail, and full-paper viewport bounds are asserted before screenshots.
This optional presentation lane is syntax-checked, not yet run; it does not add full S01-S18 coverage.
