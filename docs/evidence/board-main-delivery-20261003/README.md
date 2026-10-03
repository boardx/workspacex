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
  deployment. This draft predates that merge and must preserve it during integration.

## Original goals and verification boundaries

The original ten-round ledger remains [fabric-board-evidence-audit.md](../../design/fabric-board-evidence-audit.md).
It is historical evidence, not an authoritative current feature-state projection.

| Round / original goal | Source in this iteration | Actual verification / remaining blocker |
| --- | --- | --- |
| R01 navigation, transforms, eraser / #4858 | Committed R01 matrix, oracle and runtime binding | Raw FixedLayout cached-pixel oracle fails with tolerance 5 unchanged. Native eight-case matrix, original 14 Chrome pixel failures and hardware acceptance remain unresolved. |
| R02 Connector capabilities / #4967 | Geometry/menu preservation from committed candidate | Original route/endpoint/label/width and cancellation acceptance not rerun. Production exposure/signoff is held. |
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
Git hooks were preserved. No database, API, Web, Docker or browser was started.
No protected data directory, service, migration or production setting was touched.

- Web typecheck and the complete Web lint chain passed after sound mock typing
  and callback dependency corrections.
- Final affected component/contract run: **268/269 passed, one failed**, no skipped
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
