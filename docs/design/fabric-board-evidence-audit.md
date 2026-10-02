# Fabric Board Evidence Audit

Snapshot: 2026-10-02, Asia/Shanghai. Issue #4880. The original audit was collected
from docs-only source `bd0f774c9210d4767f746176a5b01e0f774f56ae`; the current
knowledge-refresh edits began from PR5010 head 4d7411d104; publication must preserve
the later maintenance head identified below.
This audit is not a feature-state source.
It does not close other issues or infer current CI, merge, deployment or hardware status.
The historical rows retain their recorded source rather than borrowing new screenshots.
At the freeze-preparation query, R10 PR5010 was OPEN/non-Draft at head
`552fe4963e9bc9229644269849c3a40320ee60d2`; this uncommitted knowledge refresh
still requires ordinary maintenance integration. Parent PR4993 was OPEN/non-Draft
at `4f82d07a32e949fad34d798ae36f2cffa45355cb`.
R09 acceptance-preparation PR5036 was queried MERGED at `2c8b33d189dc8453b1ac8dcd1121039f9ae1a6b1`.
Those queries do not establish current CI, main ancestry or actual runtime acceptance.

## Evidence Ledger

| Round / Scope | Source And Publication | Actual Evidence And Missing Gates |
| --- | --- | --- |
| Initial delivery | [PR4965](https://github.com/boardx/workspacex/pull/4965) queried OPEN/non-Draft, head `fdd6ef8d0c91bdbbe744dd8a756aae326a807577`; not one of ten rounds | No independent complete initial runtime audit here; current CI/review/merge unverified. |
| 01 Navigation, live transforms, eraser / #4858 | Run16 runtime `48a96cbe2e68f49167b9da54a4d9d44fd0c80b28`; later Hand subcase runtime `30432d5224f880909aa6eadcf0ff3b00d83504e4`; [parent PR4993](https://github.com/boardx/workspacex/pull/4993) | Run16 21/21 with HTTP/browser errors zero, start/end exact SHA and 32 source hashes, owned fixture 404. Later Hand report `/private/tmp/wsx-hand-over-object-green-30432/result.json` independently read: pass, cleanup404, endAttestation; zoom1.1 held pan80/40, geometry and canonical hash unchanged. Its before/held/released PNGs remain attached to 30432, not latest parent source. Software subsets only; native Mac gestures and complete current-round acceptance pending. |
| 02 Connector capabilities / #4967 | [PR4998](https://github.com/boardx/workspacex/pull/4998) queried OPEN/non-Draft, source `60b374e7cf8f976994828705915fcaac95b09818` | Earlier audit found incomplete path/endpoint/style/cancellation pixels. Stable below-menu acceptance at 60b is reported RED in [issue5042](https://github.com/boardx/workspacex/issues/5042), not a passed Connector round; original report/screenshots still require binding here. Missing earlier tests alone did not establish product bugs. |
| 03 Connector authority / #4968 | [PR5002](https://github.com/boardx/workspacex/pull/5002) queried OPEN/non-Draft, head `5850b4e06c84c677ff19e05b357a6bec317f5f00` | Publication is established, not complete runtime acceptance. Separate principals/processes, viewer/tenant rejection, races and complete history/interchange evidence not audited. |
| 04 One-shot tools / #4859 | [PR5005](https://github.com/boardx/workspacex/pull/5005) queried OPEN/non-Draft, head `27b69eafef94a86d9b4eb47e2e4821562360dfbc` | New candidate screenshots, API/reload, cancellation and fixture cleanup not audited; original mixed-worktree passes cannot replace them. |
| 05 Drawing / #4969 | [PR5003](https://github.com/boardx/workspacex/pull/5003) queried OPEN/non-Draft, head `8f0e2d2227e64eec879dde8c0f0b795e499d4ba5`; old focused evidence remains bound to its original source | Worker focused/lint/typecheck evidence does not replace runtime acceptance. Original run1 midpoint RED and Run3 rawRGBA RED remain in the diagnostic index below; no successful complete runtime report or accepted iteration here. |
| 06 Sticky / #4222 | [PR5000](https://github.com/boardx/workspacex/pull/5000) queried OPEN/non-Draft, head `354d7b1e10307bc12c9524fdcb42e96c495f381e`; metadata follow-up [PR5012](https://github.com/boardx/workspacex/pull/5012) head `b51c6db38f7c21a0840b6e535cc451ec7bc6cbbc` | Full S01-S18 per-candidate acceptance, permissions, two-user rendering and native IME remain unaudited. |
| 07 Images / #4860 | [PR5004](https://github.com/boardx/workspacex/pull/5004) queried OPEN/non-Draft, head `8c45186c7f593ee50fe09f76368f87ea38388fe1` | Real picker/drop/paste/HTTPS, byte digest, refresh, failure/retry and cleanup proof not audited. |
| 08 Cloud sync / #4970 | [PR5007](https://github.com/boardx/workspacex/pull/5007) queried OPEN/non-Draft at `0270e6844a651875dee550a6085baa5e1e27fb2e`; separate shared-outbox runtime source `4c3dd7f5da7ec63a7952aabc047f509734790f46`, independently read DB endAttestation; [narrow acceptance comment](https://github.com/boardx/workspacex/issues/5029#issuecomment-5945971469) | `/private/tmp/wsx-shared-outbox-browser-run2/report.json`: expected1/unexpected0/skipped0/flaky0. Browser evidence JSON records 16 UI edits, drain10571.784166ms, seq1→17 and reload17. DB readback has 17 rows/17 distinct IDs, archived fixture, endAttestation true. Screenshot directory below. This is a same-browser shared-outbox subcase, not full R08 or acceptance of current PR5007; Frame caveat and broader coverage remain. |
| 09 Files / #4861, acceptance #5032 | Implementation PR5006 merged into parent Navigation, not established main delivery; acceptance preparation [PR5036](https://github.com/boardx/workspacex/pull/5036) source `2c8b33d189dc8453b1ac8dcd1121039f9ae1a6b1` queried MERGED | Human approved optional multipart fileName compatibility; strict real-runtime spec prepared, not executed. Real multipart names, DB/RLS write counterproof, download/refresh, cleanup and screenshots remain pending. Synthetic DataTransfer is not native OS drop proof. |
| 10 Skill / #4880 | Existing [PR5010](https://github.com/boardx/workspacex/pull/5010) queried OPEN/non-Draft at `552fe4963e9bc9229644269849c3a40320ee60d2`; current refresh uncommitted | Metadata validation exit0; links failed missing yaml before initialization. Actual no-history session completed five navigation tasks for the historical dirty content snapshot, documented below. Clean final source, standard gates and real document/Mermaid preview remain pending; this does not prove a later source was freshly read or any business round passed. |

## Execution Bindings For The Ledger

The ledger above and these execution bindings form one index. A command template is
not an executed command: retain the literal command and exit status with each actual
report before upgrading a row. Values in angle brackets require a frozen runtime and
owned fixture; do not publish auth/storage-state contents in this index.

| Round | Runner / Reproducible Entry | Execution Binding Still Needed |
| --- | --- | --- |
| 01 | `node scripts/local-session/board-navigation-acceptance.mjs --base <web> --api <api> --out <evidence> --data-dir <owned-db>` | Run16 raw report binds its historic source; obtain the literal recorded command before reproducing. New Hand subcase is separate from the full round. |
| 02 | Connector runner path/CLI to be supplied by its acceptance owner | Fresh source, case manifest, literal command and report/screenshots pending; do not infer them from published code. |
| 03 | Authority runner path/CLI to be supplied by its acceptance owner | Distinct-principal DB/HTTP/browser run and negative-path screenshots pending. |
| 04 | One-shot tool runner path/CLI to be supplied by its acceptance owner | Fresh desktop/mobile menu/create/drop/cancel screenshots and persistence run pending. |
| 05 | `node /private/tmp/wsx-r05-draw-acceptance.mjs --root <candidate> --base <web> --api <api> --manifest <manifest> --storage-state <private-state> --board <owned-empty-board> --out <evidence>` | Existing runner asserts source 8f0e2d2227e64eec879dde8c0f0b795e499d4ba5. Failed logs and diagnostic PNGs remain separate; successful full report pending. |
| 06 | Sticky S01-S18 runner path/CLI to be supplied by its acceptance owner | Exact candidate and all prescribed real UI/API/history/peer evidence pending. |
| 07 | Image runner path/CLI to be supplied by its acceptance owner | Byte digest, picker/drop/paste, retry, refresh and screenshots pending. |
| 08 | `node /private/tmp/wsx-shared-outbox-runtime-4c3dd/apps/web/node_modules/@playwright/test/cli.js test --config /private/tmp/wsx-shared-outbox-acceptance/playwright.config.mjs` | Config/spec paths independently exist; one worker, retries0. Run2 outputs bind `PRIVATE_ACCEPTANCE_OUT=/private/tmp/wsx-shared-outbox-browser-run2`; do not expose private transport traces or auth state. Subcase cannot close the broader round. |
| 09 | `pnpm --filter web exec playwright test --config e2e/board-files-existing-runtime.config.ts` | Prepared spec source 2c8b33d189dc8453b1ac8dcd1121039f9ae1a6b1 in PR5036, not yet executed. Required runtime environment and private credential setup live in its [acceptance plan](https://github.com/boardx/workspacex/blob/2c8b33d189dc8453b1ac8dcd1121039f9ae1a6b1/docs/evidence/board-files-4861/real-acceptance-plan.md); resolve that source if absent locally. |
| 10 | `python3 <skill-creator>/scripts/quick_validate.py .agents/skills/mod-fabric-canvas`; `node .agents/skills/mod-fabric-canvas/scripts/validate-links.mjs`; `node --test .agents/skills/mod-fabric-canvas/scripts/validate-links.test.mjs` | Metadata validation exit0 on this dirty docs candidate; link validation failed missing yaml before standard init. Final source and normal gates pending. |

R10 visual acceptance is a real preview of this skill entrypoint and the plan Mermaid,
not an unrelated whiteboard screenshot. After freezing the docs source, open the saved
SKILL.md and plan in the app, render the actual Mermaid using the available preview,
and capture both views with file/source identity in the report. A fresh skill-use session
must read SKILL.md, follow its input/projection and verification routes, locate the Hand
and drawing-oracle source/tests, and state their unverified runtime boundaries. Record
that actual session output; a prepared walkthrough is not proof it ran. Preview
artifacts have not been captured; the actual historical skill-use session follows.
The reproducible independent task is maintained once in
[fresh skill use](../../.agents/skills/mod-fabric-canvas/scripts/fresh-skill-use.md).

The actual independent five-task session is now recorded in
[fresh-use evidence](../evidence/fabric-skill-4880/fresh-use-20261002.md).
It binds HEAD552fe and the unchanged historical dirty content blobs, including audit
06f8deb86a1084ed26fc402c85dd0ab9523ee9e2, not this subsequently appended audit blob.
Skill navigation passed for that read snapshot; final clean source and preview were
not executed by that session. Do not rewrite its source binding after this addition.

Shared-outbox raw bindings are `/private/tmp/wsx-shared-outbox-browser-evidence.json`
and `/private/tmp/wsx-shared-outbox-db-readback.json`; publish only their bounded
acceptance summary, not private rows/transport payloads. Screenshot directory:
`/private/tmp/wsx-shared-outbox-browser-run2/shared-outbox-same-browser-2c7fb-x-without-duplicate-commits/`,
with `pending-original.png`, `acked-original.png`, `acked-peer.png`,
`reloaded-original.png`, `reloaded-peer.png`. These remain 4c3dd source artifacts.
The [Frame visual limitation comment](https://github.com/boardx/workspacex/issues/5029#issuecomment-5945998386)
is part of that acceptance boundary, not overwritten by a later Frame source fix.
This 4c3dd fixture used API-seeded panels plus 16 UI edits. The later Navigation
4f82d07a3 fixture changes the gate to eight real UI creations plus 16 UI edits (24 writes).
That different fixture requires its own runtime/report; the old seq17 and drain10571
cannot establish the new 24-write gate passing.

## R01 Raw Evidence And Boundaries

Local evidence root: `/private/tmp/wsx-navigation01-run16` (private local artifact,
not a portable repository link). `results.json` contains exact startup/end provenance,
API heads/readback, 21 individual results, browser/HTTP failures, fixture cleanup and exclusions.
Screenshots: `multi-rotate--30-held.png`, `multi-rotate--60-held.png`,
`multi-rotate-redo-reload.png`. The coordinator performed independent screenshot review.
Owned runtime subsequently stopped; environment agent reported all three ports released.
These shutdown facts are reported operational evidence, not evidence of a deployed service.

Run16 Highlighter uses explicit 25% opacity. Default Highlighter was a real historical RED
and remains an R05 acceptance gate. R01 attached-line fixture intentionally uses no arrowhead
to isolate entity pixels; free overlay pan retains an arrow, but arrowhead styles belong to R02.
Synthetic input/blur does not establish native Trackpad, OS IME or clipboard success.
Run1-Run15 failures remain separate evidence; their later fixes do not rewrite failed reports.

## 2026-10-02 诊断更正索引

This is a dated diagnostic index, not a replacement for the live delivery ledger.
Detailed experience is maintained once in the Fabric skill references:

- [Hand reconciliation](../../.agents/skills/mod-fabric-canvas/references/input-and-projection.md#hand-与-canonical-refresh-的交互边界):
  source 30432d5224, four independent RED cases and 89 focused component tests;
  this does not establish the long meeting journey passing.
- [Pixel and mock oracle corrections](../../.agents/skills/mod-fabric-canvas/references/verification.md#像素-oracle-与归因更正):
  original R05 run1 `/private/tmp/wsx-r05-browser-run1.log` remained RED.
  No-reload diagnostic PNGs under `/private/tmp/wsx-r05-release-paint-probe/`
  identify selection-control occlusion, not a confirmed blank drawing product defect.
  Escape did not clear selection in the later five-step diagnostic; the actual result
  and unchanged-document boundary are recorded in the linked single-source reference.
  The revised runner has not yet supplied a new successful complete runtime report.
  Latest Run3 `/private/tmp/wsx-r05-browser-run3.log` remains RED at runner line78:
  `Real rawRGBA must match the single expected source-over instrument alpha`.
  Whether thin-line pixel coverage invalidates that oracle is still a diagnostic question;
  this index does not relabel the failure as a product defect or a passed drawing round.
  Initial-test correction fd2ceaf4 has focused 20/20 and normal-push evidence, not
  browser acceptance; see its
  [publication comment](https://github.com/boardx/workspacex/pull/4965#issuecomment-5946419315).
- [Exact Playwright runtime preparation](../../.agents/skills/mod-fabric-canvas/references/verification.md#ci-前提):
  runner source 1e1eb5d5 owns planning/install/execution; old missing-browser failures
  remain preparation failures and cannot be relabeled as successful pixel acceptance.
  Superseded preparation PR5029 was queried CLOSED; its shared work moved through
  the parent Navigation branch. That publication transition is not browser acceptance.
- Frame follow-up narrow pixel acceptance is independently bound to
  `/private/tmp/wsx-frame-pixels-cddb-run2/frame-outline-evidence.json`: start/end
  source cddb6541cd77976e8684ed5d69800c70365ee054, oktrue, cleanup404true, six samples
  (default gray and explicit red, each created/patched/reloaded). Six actual PNGs in
  that directory follow `<phase>-<id>-canvas.png`, including
  `reloaded-default-frame-canvas.png`. Original run1 list-reporter body attachments
  did not persist; run2 JSON captured evidence without changing assertions.
  Titles are visibly present but title contract acceptance is not claimed. This
  Frame subcase neither closes a whole round nor certifies later source screenshots.

## Updating The Ledger

Record a new exact source SHA only after freeze; associate screenshots/API/refresh/cleanup
with that same source. Distinguish implementation, local acceptance, publication, live CI,
review and merge. Requery GitHub and ancestry when making current delivery claims.
An evidence-only commit does not silently replace the tested runtime source.
Resolve absent source helpers at a supplied PR/exact commit conditionally; do not add business
code to this skill PR to make links exist. Keep missing sources and unresolved findings explicit.
No temporary auth state, session tokens, account credentials or private board contents belong here.
