# Fabric Board Evidence Audit

Snapshot: 2026-10-02, Asia/Shanghai. Issue #4880, docs-only candidate based on
`bd0f774c9210d4767f746176a5b01e0f774f56ae`. This audit is not a feature-state source.
It does not close other issues or infer current CI, merge, deployment or hardware status.
Publication references below were read from the coordinator's local ten-round plan;
R02 publication was independently queried with `gh pr view` before this update.
Current CI checks and merge ancestry were not independently queried for this document.

## Evidence Ledger

| Round / Scope | Source And Publication | Actual Evidence And Missing Gates |
| --- | --- | --- |
| Initial delivery | Published [Draft PR #4965](https://github.com/boardx/workspacex/pull/4965); not one of ten rounds | No independent initial runtime audit here; current CI/review/merge unverified. |
| 01 Navigation, live transforms, eraser / #4858 | Runtime `48a96cbe2e68f49167b9da54a4d9d44fd0c80b28`; coordinator published [Draft PR #4993](https://github.com/boardx/workspacex/pull/4993), evidence-only head `5be0a4ef63868d58e2f6b8c8d8d7bb37fbef967d` | Run16 report independently read: 21/21, HTTP/browser errors zero, start/end exact SHA and 32 Git-blob source hashes, owned fixture fresh 404. Held -30/-60 entity/frame/menu, single release, Undo/Redo/reload; screenshots listed below. Software subset only; native Mac gestures unaccepted. Current CI and merge not established by this report. |
| 02 Connector capabilities / #4967 | [Draft PR #4998](https://github.com/boardx/workspacex/pull/4998), head `fad52d981c8fb76821f75409b537f1b5ee315f45`, stacked on the navigation PR branch; `gh pr view` confirmed OPEN/Draft at this update | Earlier runner read-only audit found incomplete route/endpoint/label/width pixels, cancellation and lower-canvas no-bbox coverage. No complete exact-head browser evidence or cleanup audit recorded here; recheck new PR implementation before treating prior gaps as current. Missing tests do not prove production bugs. |
| 03 Connector authority / #4968 | Exact candidate SHA / PR pending | Separate principals/processes, viewer/tenant rejection, races and complete history/interchange evidence not audited. |
| 04 One-shot tools / #4859 | Exact candidate SHA / PR pending | New candidate screenshots, API/reload, cancellation and fixture cleanup not audited; original mixed-worktree passes cannot replace them. |
| 05 Drawing / #4969 | Published [Draft PR #5003](https://github.com/boardx/workspacex/pull/5003), head `9fd45254adf30458ea7ab9a2fd894840e3bb79aa`, stacked on the navigation PR branch | Local worker focused tests and lint/typecheck reported; independent review found P shortcut appearance and fixed eraser-width control defects. Follow-up focused 15/15 and lint/typecheck passed; the parent topology merge preserved the complete tree bytes. Fresh independent review and full LiveBoard screenshots/API/history/cleanup remain pending. No accepted iteration or green CI claim. |
| 06 Sticky / #4222 | Exact candidate SHA / PR pending | Full S01-S18 per-candidate acceptance, permissions, two-user rendering and native IME remain unaudited. |
| 07 Images / #4860 | Exact candidate SHA / PR pending | Real picker/drop/paste/HTTPS, byte digest, refresh, failure/retry and cleanup proof not audited. |
| 08 Cloud sync / #4970 | Exact candidate SHA / PR pending | Real disconnect/reconnect, ACK/API/refresh/peer agreement and readonly/unmount proof not audited. |
| 09 Files / #4861 | Exact candidate SHA / PR pending | Human approved optional multipart fileName compatibility; approval is not implementation. Real multipart special names, HTTP security, byte digest, download/refresh and cleanup remain unaudited. |
| 10 Skill / #4880 | This docs candidate; no final source SHA / PR yet | Frontmatter/link validation and independent navigation review required. Its init/focused docs tests do not prove the nine business rounds. No Chromium CI or business code included. |

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

<a id="2026-10-02-诊断更正索引"></a>

## 2026-10-02 诊断更正索引

This appended historical index restores navigation to committed skill experience.
It does not update the older ledger's publication queries or certify any current
source, CI, main delivery or full-round browser acceptance.

- [Hand reconciliation](../../.agents/skills/mod-fabric-canvas/references/input-and-projection.md#hand-与-canonical-refresh-的交互边界):
  source `30432d5224f880909aa6eadcf0ff3b00d83504e4`, four RED counterexamples
  and 89 focused component tests. This does not establish the long meeting journey.
- [Pixel and mock oracle corrections](../../.agents/skills/mod-fabric-canvas/references/verification.md#像素-oracle-与归因更正):
  original drawing failures remain RED. Actual normal-UI selection diagnostics
  distinguish control occlusion from missing ink; the actual Group/Path correction
  `fd2ceaf4c2c55f8ac19eb33d40654f0a48aa2de7` records focused 20/20, not business
  browser acceptance. No older screenshot certifies the current delivery head.
- [CI prerequisites](../../.agents/skills/mod-fabric-canvas/references/verification.md#ci-前提):
  browser installation must exist in the same executing job. Link navigation does
  not establish successful installation or acceptance of a later runtime source.

## Skill Navigation Execution Binding

The [five-task reader packet](../../.agents/skills/mod-fabric-canvas/scripts/fresh-skill-use.md)
is prepared input, not proof of a fresh reader. A genuinely independent no-history
reader must preserve its actual response, task identity, frozen full HEAD and
followed reference/code/test lines. An inherited-context recovery inspection does
not satisfy that gate. Keep document preview, actual business runtime, CI and
main ancestry evidence separate, and retain hardware manual-required boundaries.

## Updating The Ledger

Record a new exact source SHA only after freeze; associate screenshots/API/refresh/cleanup
with that same source. Distinguish implementation, local acceptance, publication, live CI,
review and merge. Requery GitHub and ancestry when making current delivery claims.
An evidence-only commit does not silently replace the tested runtime source.
Resolve absent source helpers at a supplied PR/exact commit conditionally; do not add business
code to this skill PR to make links exist. Keep missing sources and unresolved findings explicit.
No temporary auth state, session tokens, account credentials or private board contents belong here.
