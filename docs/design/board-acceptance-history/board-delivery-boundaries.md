> Historical snapshot, 2026-10-02. Not current approval, runtime acceptance, or feature status. See README.md and issue #5001.

# Board Delivery Boundaries

## Human-Requested PR Assembly: Read-Only Recommendation

Origin destination verified as `https://github.com/boardx/workspacex.git`; the separate template
remote is not the destination. Latest live issue queries #4858 and #4878 succeed as OPEN with no
closing-PR references. Open-PR inventory fails networking, so existing-PR absence is still unknown.
No Git/index/push/PR operation was performed by this documentation audit.

First implementation delivery candidate: R1 #4858 navigation/live-transform scope, with only its
Surface navigation/preview/control sections, input/coordinate helpers, drawing hit/cache changes
if explicitly within issue scope, and existing endpoint-offset-only core fix. Exclude newer
Connector route/appearance/hidden-projection changes, Sticky fonts/layout, image/sync and files.
Validate the isolated tree rather than counting the combined worktree's green suite for this PR.

R2 #4859 owns generic one-shot dock/drag/text-shape-draw preview infrastructure. Local `origin/main`
does not contain `board-tool-preview.tsx`, so #4222 selected Sticky preview genuinely requires that
R2 prerequisite at this inspected base. Sticky owns fixed-shape text fit/font refresh/draft safety
and recent drag state; do not bundle the entire R2 drawing/tools PR into it. R3 #4860 can stand
alone only after its editor image/retry/sync hunks are separated from R4 file imports/state/drop.
R4 quote contract is unapproved and must not be included merely to obtain a combined green tree.

Connector #4878 canonical route/width/label/path/snap/CAS core is coherent single-issue scope;
UI adds its dedicated modules plus shared editor/dock/Surface hunks and all negative/history tests.
Do not assign entire shared files or absorb R1/Sticky/R3/R4. Its existing runner imports Sticky
runner infrastructure: establish a script dependency or standalone runner before isolated-tree
verification. #4880 documentation is an even smaller possible first delivery only if exact-tree
links to pending business sources remain qualified; the global skill baseline failure is separate.

Before any creation: recover existing-PR inventory, refresh verified remote base, prove coherent
issue-only imports and exact-tree gates/review, then main handles authorized PR creation/attachment.
This recommendation changes no feature state or signoff and authorizes no direct merge.

2026-10-01 local audit. This document records delivery boundaries, not feature status or design signoff. Preserve the current dirty checkout and its existing branch; no commit, PR, reset, Docker operation or merge was performed by this audit.

## Issue Ownership

| Issue | Intended change | Shared hunks requiring explicit separation |
| --- | --- | --- |
| #4858 R1 | Trackpad wheel navigation, middle/right mouse pan, live transforms, drawing hit/erase transactions | Fabric surface navigation/transform/drawing sections; editor transform preview and drawing commit; `document.ts` existing endpoint offset correction only |
| #4859 R2 | Single-shot tools, visual text/shape/sticky menus, draw controls and tool drag | Dock creation state and editor creation/drop sections; generic previews distinct from later Mural fixes |
| #4860 R3 | Image entry/error/retry integration, cloud sync indicator and reconnect | Editor image imports/state/handlers/dialog; header and live-board status wiring; comments-readable gating |
| #4861 R4 | Ordinary file upload/download, tenant protection, migrations and lifecycle rejection | Editor file imports/state/drop/download; API unit config file alias/test include; kernel DI only within recorded exemption |
| #4222 Sticky | Actual selected sticky previews, recent drag selection, draft safety, fixed-shape text fit/full-text access | Editor sticky creation/editing/viewing sections; Fabric sticky layout/font refresh; thinking-input editor; core known-metadata duplicate guard; API unit config sticky test include |
| #4878 Connector | Durable route/width/label fields, snap/gesture UI, route resolution and projection | Contracts canonical fields; core document/spatial geometry; editor connector hook/controls; dock connector entry; Fabric path rendering/hit projection |
| #4880 Skill | Dedicated Fabric Canvas skill and existing skill routing | Documentation only; references to unmerged implementation must retain pending/local qualifications |

`collaborative-thinking-editor.tsx`, `board-fabric-surface.tsx`, `board-bottom-dock.tsx`, `board-content-tools.test.tsx`, `document.ts`, core `index.ts` and API unit config cannot be assigned wholesale to a single issue. Build each candidate tree with an explicit hunk map and test it independently. Do not stage whole files merely because an owner edited them.

The API unit config `work-eval` alias is a baseline test repair, not evidence that file or sticky business behavior passes. Route-related additions in `document.ts` depend on `connector-path.ts` and contracts changes, whereas the earlier two endpoint-offset arguments can travel with R1 independently. Sticky fixed sizing/font layout belongs to #4222, not the generic R2 tool creation change.

## Current Evidence Boundaries

### Latest Coordination Snapshot

The human approved Connector development after the prior design-gate question ("我批准，你先完成开发"). The human also approved the recommended Sticky fixed-shape/size, wrap-and-shrink-to-readable-floor, complete editable scrolling text policy ("按照你的推荐的设计来开始开发"). These are recorded human decisions, not agent-authored signoff statuses; this audit does not edit the authoritative approval files or feature list.

Live six-worker snapshot: `connector_core`, `connector_editor`, `browser_acceptance`, `review_canvas`, `review_security`, `delivery_checks`. Main session remains the integration and acceptance decision owner. Core/contracts and editor are exclusive business writers; reviewers report findings rather than independently editing those hotspots. Browser acceptance owns runner/evidence corrections; delivery checks owns this document only. New shared-file work must be routed to the existing writer, not another concurrent patch.

Resource rule: schedule heavy API/Web/core runs through one verification lane. Do not overlap whole suites, typechecks or independent runtimes merely to occupy six workers; other lanes perform focused low-cost review, runner preparation, evidence audit or independent tests with main coordination. Do not kill a process without verified ownership. The main session reports the owned runtime restored as session `25258` using the existing task data directory; runtime recovery is not browser acceptance.

New focused P1 guard evidence reported by main: core 8/26, web 18 and independent receipt 21 green. These are focused results, not a fresh full-suite result. Browser R01/T01 is starting; it is not recorded passing here. Source is still evolving, so final SHA/source-frozen regression and browser gates remain outstanding.

- Connector source files now exist locally. `scripts/local-session/board-connector-acceptance.mjs` is still a candidate inventory: `--plan` validates C01-C21 count and exits 0; without it the script exits 2. Neither invocation executes a browser check.
- Sticky M0 subset evidence must remain distinct from all S01-S18 requirements. Native IME, actual Mac Trackpad hardware, two browser processes, permission denial and long-text pixel proof require their own fresh evidence after current source changes.
- The affected-test Chromium workflow patch has a dedicated eight-case test file. Reported local test success is not a GitHub workflow result; installation and actual affected CI still require a PR run.
- Full API suite exit 137 has no established cause here. A sandboxed read-only `ps` attempt returned EPERM. This audit did not kill processes, retry a costly suite or label the event an OOM. Orphan ownership must be established before cleanup.
- Skills doctor has a reported pre-existing `mod-project` missing-file failure. That does not make the new skill globally passing and must not be repaired by unrelated churn.
- No current change is declared merged, CI green or feature passing by this document. Historical counts in the older backlog are not fresh-source evidence.

## Candidate Independent Gates

Run from the repository root in each isolated candidate tree. The commands below are a required plan, not recorded passes. Keep browser installation available for tests launching Chromium and coordinate source freeze before final browser evidence.

```bash
git diff --check
pnpm --filter @repo/whiteboard-core test -- --no-cache
pnpm --filter @repo/whiteboard-core typecheck
pnpm --filter web lint
pnpm --filter web typecheck
pnpm --filter api lint
pnpm --filter api typecheck
pnpm --filter api exec vitest run --config vitest.whiteboard-unit.config.ts --no-cache --maxWorkers 1
pnpm exec vitest run .harness/scripts/ci-affected-chromium.test.ts --no-cache
pnpm run lint:skills-doctor
```

Web gates must additionally run all board UI and `tests/whiteboard` suites, not just the new tests. Reuse the existing mechanically selected board test list rather than a root-relative shell glob from the web workspace. The API command is an independently scheduled resource-heavy gate: a previous nonzero termination cannot be replaced with a candidate pass.

Browser commands require an explicitly authorized storage-state path outside the repository; never commit tokens, credentials or runtime files. Sticky script `--m0-only` proves only its declared subset. Connector needs an implemented real-browser runner before any C01-C21 completion claim. File security/freeze and upload retry scripts must prove real API persistence and owned fixture cleanup, not intercepted success alone.

Before PR creation: compare each tree with current remote base, preserve unrelated remote changes, verify dependent imports, capture exact tree SHA and test outputs, obtain independent review against that SHA, attach one issue per PR, and wait for actual CI. Main session controls splitting and PR creation; this audit authorizes no direct merge.

## Necessary Versus Incidental Dependencies

- Connector core imports new contract route/label/width definitions; its schema, path resolver, snap helper, document and spatial-command changes are one coherent #4878 unit. Connector UI imports those core exports, so the #4878 PR must include or explicitly depend on that core implementation. Sharing a document file with R1 does not make all R1 navigation fixes a semantic dependency.
- Connector dock wiring currently shares the R2 dock file and generic creation union. Preserve the existing union baseline and cherry-pick the connector import/prop/entry hunks; new Connector UI modules do not import the new Sticky layout helper. A blanket #4878 dependency on all #4222 is therefore not supported by the observed imports.
- Sticky text fit needs its Fabric layout helper, font-revision hook, editor integration and draft-safe text editor together. The selected-preview changes import generic `board-tool-preview.tsx`; if that file is absent at the chosen remote base, #4222 needs the relevant R2 preview prerequisite or a documented stacked dependency, not the entire drawing/tool backlog.
- Ordinary file integration needs contracts, migrations, API repository/service/controller/DI and web upload module together. Images and cloud sync are different APIs and do not require the new ordinary-file controller. R4 before R3 is a convenient shared-editor stack order, not an inherently required business dependency.
- The CI Chromium prerequisite must land in every candidate whose tests launch Chromium, either in that PR's explicitly owned infrastructure scope or as a preceding dedicated prerequisite. It must not silently be counted as a #4880 documentation change.
- #4880 skill can be an independent documentation PR only while references to pending code remain explicitly conditional and source links resolve for its exact candidate tree. Candidate dependencies must be checked against the fresh remote base; this import audit does not prove any current remote tree already contains the prerequisite.

## Fresh Incremental Evidence

2026-10-01, this delivery worker executed:

| Command | Actual result | Boundary |
| --- | --- | --- |
| `pnpm exec vitest run .harness/scripts/ci-affected-chromium.test.ts --no-cache` | Exit 0; 1 file, 8/8 tests; Vitest duration 409 ms | Workflow structure/parser tests, not an actual GitHub affected job or browser install |
| `python3 /Users/shenyanbin/.codex/skills/.system/skill-creator/scripts/quick_validate.py .agents/skills/mod-fabric-canvas` | Exit 0; Skill is valid | New skill format only, not global skills doctor |

The skill reference increment was validated separately: 12 local Markdown links and seven newly cited source paths exist in the current local tree. The resolver's current-tree check is not evidence that an independent documentation PR base already contains unmerged business helpers. Global skills doctor retains its separately reported pre-existing failure.

The following are incremental results supplied by main/other owners, not rerun by this delivery worker; preserve their original logs and exact source scopes when assembling PR evidence:

| Scope | Reported result | Remaining gate |
| --- | --- | --- |
| Core full suite | 214 green | Candidate-tree exact SHA and CI; do not combine with focused counts |
| Surface/text | 70 green | Frozen integrated web regression and browser coverage |
| Independent receipt | 21 green | Full suite and actual collaboration cases |
| Editor CAS / detach | 4 and 6 green respectively | Integrated regression; counts remain distinct |
| Sticky focused / R01-T01 browser subset | 18 and 14 green respectively | Full Sticky standard; subset is not all S01-S18 |
| Connector run3 | Required keyboard case failed | Must fix and rerun the required keyboard behavior |
| Connector run4 and button atomicity | Later partial results exist | A toolbar button's atomic transaction does not satisfy keyboard C10 |
| R4 file/header repair | Owner reports 18 file-assets unit tests green | Independent review still pending; not an independent security acceptance pass |

These counts overlap and refer to different scopes. There is deliberately no aggregate "all tests passed" total. Source changes after a result invalidate its claim for a later candidate tree unless affected gates are rerun.

### API Configured Manifest Gate

Read directly on 2026-10-01: `/private/tmp/wsx-api-batches-20261001-run1/summary.json`.
All 74 configured files were executed exactly once across nine sequential isolated Vitest batches;
729/729 tests passed, zero skipped, all nine process exits 0, `exactCoverage:true`, `success:true`.
Before/after source hash matched `3b1115309ec1608b68ad2dcc23ab9d7ff7186e52cda8c9f663b339301dc80517`.
The report carries each full planned/actual batch manifest; it is not a selective focused subset.
This proves the complete configured API unit manifest via bounded sequential batches, not a successful
single-process full-suite invocation. The prior exit 137 remains a separate failed execution with
unestablished cause, not retroactively changed to pass or diagnosed as OOM.

Connector C10's real keyboard fix now has a reported 22-test unit pass. Run8 browser acceptance is
still in progress; neither that unit result nor earlier button atomicity proves browser C10 yet.

Superseding browser evidence, read directly on 2026-10-01:
`/private/tmp/wsx-connector-pointer-run9/report.json` reports strict `subset-pass`,
7/7 Connector checks plus 9/9 Sticky checks (16/16 executed checks), with
`coverageComplete:false` and `requiredSuiteComplete:false`. It includes real Meta+Z and
Shift redo with natural host focus, independent black Fabric path pixels for C07,
width 7, multiline label, label drag and API/reload persistence. All 21 Connector standard
cases still have `complete:false` and remain partial-subset-pass or not-run.
Run8's pixel-oracle failure from overlapping old purple geometry remains a failed historical
run; run9 chose distinct anchors to remove oracle occlusion, not a production-code change.
The statement above that run8 was in progress is historical and replaced by this run9 evidence.
New Sticky19 results are still awaited; they are not implied by run9's nine Sticky checks.

### New Blocking Projection Regression

Independent reviewer `review_canvas` reports a real-Fabric 1/1 RED reproduction in
`apps/web/tests/ui/board-connector-preview-revision-independent.test.tsx`: temporary preview
revision can collide with remote canonical revision; cancellation then leaves old painted path.
The editor writer is scheduled to fix local appearance identity after Sticky19 releases the source
freeze. Canonical revisions must not be changed merely to invalidate local paint. Run9 remains
valid historical subset evidence for its recorded source hashes, not final green for newer code.

Required order: finish/record Sticky19 frozen run, apply local projection identity repair, reproduce
RED-to-GREEN on the independent Fabric test, rerun affected path/gesture/cancellation/browser checks,
then freeze and record the new exact candidate tree. No PR-ready claim before this blocker closes.

### Connector Exact-Tree Hunk Inventory

#4878 owns new `board-connector-*` UI modules, `connector-gesture.ts`,
`use-board-connector-gesture.ts`, core `connector-path.ts`/`connector-snap.ts`,
contracts route/width/label additions, core export additions and matching document/spatial-command
route/CAS/authority guards. New tests belonging to that issue include
`connector-authority-guard.test.ts`, `connector-canonical-fields.test.ts`,
`connector-path.test.ts`, `connector-snap.test.ts`, all `board-connector-*` UI tests (including the
independent preview-revision regression), `connector-editor-authority-independent.test.tsx`,
`connector-history-shortcut.test.tsx` and `connector-gesture.test.ts`.

Shared hunk obligations: Surface connector path/appearance-identity projection must include its
new invalidation regression, while navigation/drawing/Sticky font refresh stay with their issues;
editor Connector hook/selection/authority/keyboard-host integration must include natural-focus
history tests, while image/file/Sticky draft sections remain separate; dock Connector flag/entry
imports must preserve R2 creation behavior. The earlier endpoint-offset regression
`connector-direct-geometry-offset.test.ts` remains R1 unless deliberately folded with a documented
single-issue scope decision. Exact-tree assembly must retain all required imports without pulling
whole shared files or silently dropping independent negative tests.

The real browser runner currently composes Sticky and Connector flows. If #4878 ships that runner,
its imported Sticky runner/classifier helpers must exist in the candidate tree or have an explicit
stack prerequisite; this script dependency is not proof that all Sticky business changes are
necessary for Connector. This is a read-only hunk plan, not an index or commit operation.

### Latest Repair And Human Screenshot Gate

The preview/canonical collision blocker above now has reported independent 63/63 GREEN evidence
after a pure local appearance-identity repair. An additional failure-cache test proves new appearance
with canonical unchanged. These supersede that specific RED reproduction, not every Connector gate.
A new independently observed P2 remains: label background TextBox uses path-wide bounds and can
obscure the line. The editor owner is repairing label background measurement; browser acceptance
waits for final source freeze and the R4 HTTP lane before a fresh run.

The human requested screenshots after E2E passes for human acceptance. Do not present old run9
images as screenshots of the latest repaired source. All rows below are placeholders, not evidence.

| Human Acceptance View | Latest screenshot | Required context |
| --- | --- | --- |
| Connector creation / snap / committed line | Pending fresh image | Frozen source hash, case/check ID, actual pointer operation |
| Connector curve handle / cancellation | Pending fresh image | Local appearance-identity repair active; independent pixel/canonical checks |
| Connector multiline label / label background | Pending fresh image | P2 repair active; line remains visible outside text bounds |
| Connector width / label drag / reload | Pending fresh image | Real API persistence and fresh browser reload |
| Sticky fixed-shape long text / scroll | Pending fresh image | Complete content retained; actual scroll viewport and geometry |
| Sticky rotation / resize / live chrome | Pending fresh image | Same frozen source; handles/menu follow actual transform |
| Narrow controls / sync header | Pending fresh image | Real hit targets, no unexpected errors or viewport overlap |

Only fill a row after the new E2E run reports its declared scope passing, strict error checks and owned
fixture cleanup succeed, and screenshot PNG/hash/path plus source hashes are recorded. Human visual
acceptance is a separate gate, not inferred from automated subset success. Main owns displaying the
actual latest screenshots to the human; this placeholder index creates no approval or completion.

Latest main-reported increments: label repair independent focused 5/5 is GREEN, including collision,
path and long-word/CJK cases; browser is generating fresh images. The rows remain pending until
actual screenshot paths and the fresh report are read. This resolves the prior label-focused RED
only and does not make the complete backlog green.

R4 HTTP run2 after restart passed strict ASCII filename cases `it's`, `(1)` and `*`, but uncovered a
real P2 Chinese filename encoding defect. Overall run2 exit was 1 despite stable source hashes;
both owned fixtures were deleted and independently checked fresh 404. Preserve that failed report,
not an all-HTTP-pass claim. Core owner is fixing production plus focused regressions; main plans
controlled restart after browser cleanup and fresh run3. No run3 success is recorded yet.

Newest UI gate update supplied by main: complete Web lint exit 0/no warnings, gen-light 49-token
and design scans pass (session 67771); editor UI/IME/draft independent 21 GREEN and security five
actual RED-to-GREEN. Core 100/tsc is core-only. Full Web typecheck session 48390 remains running
without result. New 1440/390 UI and 24-position browser evidence/screenshots are pending; no old
image or scoped unit count is substituted for those gates.

### Final-UI Gate Increment

Superseding older running typecheck entries: first Web typecheck session 48390 failed on independent
test typings, later repaired with reported 63 focused checks; subsequent full Web typecheck 20507
passed. Latest main-executed Web lint 61166 and typecheck 12493 both exit 0. Preserve those distinct
attempts rather than rewriting the first failure.

Complete UI+whiteboard run: 593 files, 4,758 assertions; 4,746 passed, seven failed, five pending.
Three failing test files are under repair; this regression gate is RED despite static checks green.
Earlier narrow popup-boundary run2 failure also remains history, not erased by partial width/label
save/reload checks.

Read actual latest desktop report:
`/private/tmp/wsx-connector-final-ui-desktop24-run1/report.json` has
`status:position-subset-pass`, `coverageComplete:false`; main records process exit 0.
This is new-UI desktop position evidence, not old chrome run2 or full C01-C21 completion.
390-width nine-scene run is executing in the same resource lane, not yet complete. Actual latest
screenshot paths may now be indexed from this desktop report with their precise subset scope;
do not infer narrow or complete-backlog approval from them.

Later menu-freeze full suite 76192 finished RED, exit 1: 595 files, 4,768 pass, two fail, five skip.
The two old assertions expect separate start-style entry and fixed-bottom class; real combined
endpoint/object-anchor interaction tests are being updated by the editor writer. Full typecheck
59011 passes after canonical fixture correction, but that does not erase full-suite RED. Necessary
object-context chevron/alignment state edits require refreeze before final screenshots and gates.

### Read-Only Single-Issue PR Audit

Live `gh issue view 4878` succeeded: OPEN, title "feat(board): FigJam-style connector gestures
and editable paths", no closing PR references. Two `gh pr list --state all --search 4878` attempts
failed connecting to GitHub; existing PR absence is therefore unknown, not established.

One #4878 PR is feasible in principle, but current dirty whole files are not that PR tree:
editor, Surface and dock mix other issues' changes. Separate imports/state/handlers/projection/tests
by the hunk inventory above; assemble and independently validate the candidate tree without pulling
Sticky/image/file/navigation business changes. The Connector pointer script imports the Sticky
runner (and its helpers), requiring an explicit script dependency or separated standalone runner.
Contracts/core route/CAS work is coherent #4878 scope; the old R1 endpoint-offset fix is separate.

New test repairs report focused 18 and cross-ownership one GREEN. Full 593-file regression rerun
`/private/tmp/wsx-web-ui-whiteboard-final-rerun-20261001.json`, main session 28116, is still running.
Neither those focused results nor this read-only audit grants PR-ready/full-suite-green status.
Blockers: unknown existing-PR state until GitHub query succeeds; exact issue-only tree not yet
assembled/verified; frozen full regression result pending; remaining full Connector requirements
and human latest-screenshot acceptance remain explicitly scoped rather than inferred complete.

Final current-menu frozen gate supersedes older pending regression records: actual
`/private/tmp/wsx-web-ui-whiteboard-final-widgets-20261001.json` has 597 files / 4,782 total /
4,777 pass / zero fail / five skip / success:true, main18961 exit0. Latest lint12157 and
typecheck66722 plus current 53 position/widget browser scenes are green for this revision's scope.
Earlier failures remain history; complete backlog/C01-C21 and quote-file contract approval remain
open. This document declares neither feature passing nor PR merge nor human screenshot approval.

Latest R4 fresh HTTP run3 remains FAIL on Chinese multipart filename mojibake; the first three
ASCII/quote cases pass but do not make that lane green. Actual evidence is
`/private/tmp/wsx-board-file-security-rfc-run3/results.json`. Core diagnosis reports the running
compiled artifact loading an old helper; production-source focused success is not proof that the
served artifact executes it. Verify the loaded artifact/helper after controlled restart and rerun
actual multipart HTTP before claiming fixed filename persistence/download semantics.

Newest main-executed full Web typecheck session 32481 and lint 89305 exit 0. Full UI+whiteboard
rerun session 28116 is still running, not yet green. These static checks do not erase R4 HTTP FAIL.

Latest actual report read: `/private/tmp/wsx-web-ui-whiteboard-final-rerun-20261001.json` contains
594 `testResults`, 4,759 total tests, 4,754 passed, zero failed, five skipped; main process 28116
exited 0. This proves the prior baseline regression repairs across that configured scope. New human
positioning/icon changes were edited concurrently, so this is not a frozen latest-source all-green
claim. New toolbar focused 22 reports pass; independent positioning 14 cases await implementation.
Main will freeze and rerun focused/static/new-browser gates for the final changes.

R4 on the newer API now passes Chinese filenames but fails actual quote decoding/persistence
(`%22`), a real remaining HTTP defect. Earlier run3 mojibake failure remains history; no complete
file-upload green is recorded until both current behavior and fresh real HTTP gate pass.

Next delivery gates: complete the remaining Connector standard cases beyond run9's strict subset;
complete remaining Sticky requirements and independent R4 review; rerun affected frozen integrated
Web/typecheck/lint gates; verify each issue's independently assembled candidate tree and exact SHA;
create one issue per PR, attach it and wait for actual CI/review green without direct merge.
