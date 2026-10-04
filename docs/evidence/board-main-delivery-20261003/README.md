# Board main delivery recovery — 2026-10-03

This is one bounded, direct-main source integration iteration. It preserves the
committed Board candidate `0f35b9232a4bd4f7cd4f94ec9fa8d6dee143bca9` and recovers
the main delivery gaps of #5201, #5137 and #5136. It also retains the narrow #5079
and #5129 source changes. No source branch or original issue is deleted or closed
by this draft. Main baseline: `7c92665b94711889255c449bd2101c71e563c7cd`.

Integration owner: session `01a0ffe1-0b39-771b-a431-f394760a401a`, branch
`codex/board-main-delivery-20261003`. The exact frozen candidate SHA is recorded in
the PR and its independent review, rather than guessed before committing.
The original Board session retains its separate uncommitted work; it was not
copied or overwritten. The identity of an additional session called “board dev”
has not been established from its name alone.

**FINAL_SCOPE_READY=false. This draft is blocked by the unchanged R01 pixel
oracle and unfinished runtime acceptance. Source presence, source review and
local static checks do not establish any of the ten rounds as complete.**

## Source preservation

[source-map.json](source-map.json) records exact heads, changed-path Git blobs,
candidate blobs and dispositions for all six retained Board PRs. All 47 changed
paths from #5201/#5137/#5136 are present. Different blobs retain reviewed main
improvements rather than blindly replacing newer code with old branch snapshots.

- #5201: retain native Text/Sticky creation, narrow placement and final selector
  driver. Preserve newer Sticky color/variant assertions. Combine native Enter
  with focused-editor Escape before real selection cancellation, keeping all
  canonical/head/update no-write assertions.
- #5137: retain the complete durable sender lease, peer reconciliation and test
  unit, plus the R08 suite closure. Keep newer strict Linux runtime identity,
  complete port/source attestation and owned one-shot cancellation/log drain.
- #5136: retain file suite, storage proof and Connector fixture dependencies.
  Bind the wrapper to the actual reviewed current verifier hash `279eb617…`;
  retain before/end digest, manifest, process and listener assertions.
- #5079/#5129: retain compact blank-point proof, held-pointer cancellation and
  native creation/reflow changes. Keep the newer Connector geometry/evidence block
  and continuous keyboard journey. No timeout extension, force click or skip.
- Native diagnostics from `254dc023c3d63ef0312062f5dd95501ffe2855ec` preserve
  the R01/R08 runner gates. Board diagnostics helper SHA-256
  `fff11111a51b8a8b4355b91ffb96bfe0178077cc2e207730801619e2ed309076`
  is connected to the reporter; only a fixed spec/code/project and finite numeric
  geometry are emitted. Failure rows and attachment restrictions remain intact.
- #5145 was externally merged into main at 2026-10-03T10:23:44Z, head
  `368220f4a164cdcba2702ab1d2056b0a74fbb16c`, merge
  `ea9ec522a9d000a78e269eb88bfbcb520379d872`. The path table retains its
  explicitly historical snapshot; it does not review the newer head. The main
  merge does not prove human exposure signoff, full native acceptance or production
  deployment. This iteration now ordinarily inherits that merge and preserves its entry exposure.

## Original goals and verification boundaries

The original ten-round ledger remains [fabric-board-evidence-audit.md](../../design/fabric-board-evidence-audit.md).
It is historical evidence, not an authoritative current feature-state projection.

| Round / original goal | Source in this iteration | Actual verification / remaining blocker |
| --- | --- | --- |
| R01 navigation, transforms, eraser / #4858 | Committed R01 matrix, oracle and runtime binding | Raw FixedLayout cached-pixel oracle fails with tolerance 5 unchanged. Native eight-case matrix, original 14 Chrome pixel failures and hardware acceptance remain unresolved. |
| R02 Connector capabilities / #4967 | Geometry/menu preservation from committed candidate | Original route/endpoint/label/width and cancellation acceptance not rerun. Main entry exposure is inherited from #5145; human signoff and complete acceptance are not evidenced here. |
| R03 Connector authority / #4968 | Current strong runtime authority and Connector fixture | Principal/tenant rejection, history/interchange and complete real suite not run. |
| R04 one-shot tools / #4859 | #5201 driver/helper plus #5129 cancellation | Pure placement/cancellation tests pass. Real trusted creation/reflow, including 400%, is not run. |
| R05 drawing / #4969 | Committed panel/resource/oracle closure | Resource/oracle pure tests pass. Earlier 20 component PNGs belong to an older SHA; no fresh LiveBoard D2/D3 acceptance here. |
| R06 Sticky / #4222 | Placement/creation and retained source | Full S01–S18, two-user permissions/rendering and native IME not run. |
| R07 images / #4860 | Shared guarded image entry | Pure entry tests pass. Real picker/drop/paste/HTTPS and POST-stage cancellation/refresh not run. |
| R08 cloud sync / #4970 | Complete #5137 peer business/suite closure | Mock provider/IndexedDB/proof tests pass. Real ACK/reconnect/two-browser/API/24 PNG acceptance not run. |
| R09 files / #4861 | #5136 suite/storage closure and multipart request source | Pure storage/request tests pass. Real authenticated PostgreSQL, bytes/download/refresh and cleanup not run. |
| R10 skill / #4880 | Original committed module navigation changes | Source/navigation work does not prove business rounds; independent linkage audit remains separate. |

## Local checks

All checks used the isolated integration tree. Official initialization ran with
`RUN_INFRA=0 RUN_START_COMMAND=0`; dependencies were installed normally and normal
Git hooks were preserved. No database, API, Web, Docker or browser was started. Latest main `492a9dc147d79f8c48833be8552964b6a916787f` is ordinarily inherited.
No protected data directory, service, migration or production setting was touched.

- Web typecheck and the complete Web lint chain passed after sound mock typing
  and callback dependency corrections.
- Initial delivery component/contract run: **268/269 passed, one failed**, no skipped
  or pending tests. Failure: `board-r01-oracle.test.ts`, raw FixedLayout cached
  stroke pixels versus the independent reference; original threshold unchanged.
- The six earlier menu failures were resolved by measuring real portal content
  at mount and following the toolbar layout before paint. The same 19 menu and
  seven image-entry assertions passed; no expected values were relaxed.
- 39 pure native runner/storage/adapter/policy/config tests passed; 17 R05 and
  multipart tests passed; six final reporter/helper privacy tests passed.
- No proxy transport/server tests or runtime/browser tests were run. CI remains
  the authority for its required checks and has not been claimed green.

This is a source recovery draft, not an accepted ten-round iteration or a release.

## Follow-up repairs within the same draft

- Actual product ShapeProjectionGroup and raw Fabric cache both reproduced rotated bitmap resampling error; independent reference was unchanged. Unsafe backing transforms now render stroked shapes directly, while safe integer grids retain actual bitmap caching. The complete original request matrix, tolerance 5 and six negative variants remain. 21 pure tests pass; native 14 cases, clipped/isolated-cache fidelity and performance acceptance remain unverified.
- Current-socket delayed original ACK attribution after a peer durable drain was first reproduced failing. Bounded exact updateId/gestureId attribution now accepts only the actual server receipt and rejects wrong/unknown/re-authorized receipts. 57 targeted provider/atomic tests pass; 45-second real peer recovery is still not claimed passed.
- Three Fabric test substitutes were missing real matrix/corner methods required by the existing read-only serializer. Their geometry interfaces now use rotation, scale and origin; original performance/command assertions remain. Three files, 23 tests pass.
- Layout preview locking incorrectly allowed N/T/S/P to arm creation and hide its toolbar. The mutationBlocked guard now prevents this while retaining H/V navigation. The old failure was reproduced; 29 targeted tests pass.
- #5079 remains open and is repaired independently on its existing branch, head fcab14006b15580d8a65ff451ae60896261e457b. Both trees share the reviewed native Cancel-selection focus/Enter and geometry/diagnostic helper patch; no old branch is silently closed. 20 targeted tests and normal hooks pass; new three-browser CI is pending.
- Original-page suspension uses target page lifecycle freeze/resume with trusted native events and independently executing peer sync/replay; no synthetic lifecycle events are used. Only source review/typechecks establish this wiring until real CI executes it. Full scaled-paper footprint is not certified by viewport-visible clearance.


## Cloud continuation, 2026-10-04

The cloud checkout fetched PR 5245 at `f529a4acc481ec2137b1d3d4dfe5af0a28642ccf`
and main at `64a92bf6c795a080c36c79207799ceded8b1456d`. The unpushed Mac
objects `9fb4c32de` and `5a301c` were not available (`git cat-file` failed);
no Mac checkout was modified. Merge commit `7abed5ace` retains main's independent
heavy batch workflow, including guards on the newly recovered R01/listener steps.

Changes in this continuation:

- C06 and origin-close read the real upstream login body before releasing the
  response to the page's full navigation. The capture forwards the upstream
  response, forbids redirect replay, requires exactly one browser POST, drains
  in-flight handlers, and retains the original error before cleanup errors.
- Files wait for the actual tile and durable head increment after upload 201,
  before reading the committed snapshot. A delayed GET-content test demonstrates
  that the existing upload implementation completes only after byte verification.
- Private failure receipts preserve nested first errors, redact fixture passwords
  and captured tokens, and record Sync stages. Blank-peer diagnostics use an
  immediate DOM read and a bounded screenshot rather than waiting for a locator.
- R01 pure fixture tests explicitly bind observation mode, independent of the
  functional-mode CI environment. Pure test temp directories use the OS temp root.

Actual verification in this cloud session:

- `./init.sh`: exit 0 using pnpm 9.15.0 and writable `/tmp` cache paths.
- Login capture/diagnostic/safe-export Node tests: 14 tests pass (6 capture cases).
- Chromium loopback diagnostic: HTTP 200, actor/token match, exactly one upstream
  POST, full navigation, and HttpOnly Set-Cookie preserved; exit 0. This is a
  diagnostic fixture, not the product API/runtime or C06 functional acceptance.
- Focused Files/drop/upload/first-failure Vitest tests: 5 files, 29 tests pass.
- Native runner pure tests under `BOARD_OBSERVATION_MODE=functional`: 26 pass.
- Main's heavy-batch tests: 22 pass. R08 proxy loopback tests: 13 pass.
- Native listener ownership tests: 20 pass. Final web typecheck and targeted ESLint: exit 0.

Remaining acceptance boundaries: the cloud environment has no exact PostgreSQL
16.15/vector 0.8.6 toolchain, and `/private/tmp` could not be created because its
parent is read-only. No complete signed native suite ran in this session. Sync's
actual lifecycle failure stage remains unconfirmed pending native runtime logs.
The literal quoted-download filename criterion stays strict and is not claimed
passed. Native visual/hardware acceptance remains deferred. ABSENT is never a
passing outcome. No merge, deployment, production permission change, or forced
push is authorized by this continuation.


### Continued independent review and diagnostics

An independent implementation review initially blocked on missing redaction of
`BOARD_SYNC_FAULT_CONTROL_SECRET` in the new private error receipts. The follow-up
adds the secret to both Sync diagnostic redaction sets immediately after reading
it, with a real error-header regression test. Five failure-diagnostic tests pass;
independent review of this correction reports implementation PASS, while formal
functional acceptance remains BLOCK.

A real Chromium 151.0.7922.173 loopback download with
`attachment; filename*=UTF-8''%22quoted%22.txt` returned suggested filename
`_quoted_.txt` with identical bytes. This disproves the literal filename criterion
for that browser fixture, not a product-runtime test. The strict acceptance
assertion remains unchanged; changing its contract requires an explicit decision.

Native environment inventory: all PostgreSQL executables and vector extension
are absent, as are bison/flex and readline/ICU headers. gcc/make/curl/lsof/Chromium
are available. The sole formal producer hardcodes `/private/tmp`; lower-level
prepare/start accept OS temp roots but are diagnostic entry points, not a passing
replacement for the complete signed suite. No existing attested runtime or runner
environment was found. No filesystem permission restriction was bypassed.
