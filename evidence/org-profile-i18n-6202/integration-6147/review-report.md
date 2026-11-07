# Independent actual-scope integration review — PR #6203

**CLEAN: no actionable P1/P2 found in the reviewed delta. This is static source/integration approval, not a claim that fresh integration validation or CI passed.**

Exact base: `dc9bc31b5658aacd4376ffa3f66e6794293ac953`.
Exact head: `2a02aa518e689752bc3c650c77115cbd19dc384a`.
Workspace: `/Users/shenyangjun/boardx/workspacex-i18n-agent-skill`.

## Actual scope and preservation

Reviewed the actual 94-file base-to-head delta: the combined PROFILE and HOME implementation, fixture, component/browser tests, two dictionary registries, append-only module knowledge, and historical evidence. Used the previous whole-source reviews and their scoped re-reviews as context, then inspected the current production diff, both new component suites, both browser journeys, registration structure, and integration proof independently. Historical screenshots were not independently re-inspected in this review; their QA remains attributed to the recorded source runs.

Git verifies merge `0802a91b0bc674a81e18e32a5a32bff60f5cb0b3` has parents `bfb608070b6ebb77156e63fde2d7f6b7c97101a6` and `defc8490f1bfc3d44e605e5e06a7aea8d071b8a9`, with the same tree as the latter. Its recorded author date corresponds to 2026-11-03 23:15:41 UTC. Reviewed HEAD preserves that merge as its first parent and develop `dc9bc31…` as its second parent. The supplied GitHub attribution to usersyj was not independently queried; local ancestry/tree facts were independently verified. No reversal or history rewriting is proposed.

Independently recomputed all recorded blob IDs against the exact HEAD and source commits, rather than trusting `equal: true` in `blob-proof.json`. All 18 PROFILE/HOME paths match `0802a91b…`; all 18 develop-side product paths match `dc9bc31…`. Re-derived both changed-path sets from their common base `c49fee15…`: neither proof list omits or adds a product path after excluding the two registries. This includes tests, fixture, activity contracts/API implementation, generated mock, and relevant prior regression fixes.

Against the accepted PROFILE/HOME merge, both registry diffs contain only the activity namespace import and spread. The module knowledge conflict resolution retains the home visibility lesson and both activity lessons from develop.

## Resource and behavior review

An independent TypeScript-AST inspection recursively expanded imported and local object spreads for both complete registries at BASE and HEAD. Each current locale has **1,243 unique keys**, with **zero duplicate keys**, equal locale key sets, **143 additions**, and **no removed keys or changed existing values**. Seventeen existing Chinese entries reference canonical constants; those expression texts are unchanged, rather than newly evaluated runtime values. All added resources and moved action labels are string literals. The new import-free namespace does not introduce a catalog/messages dependency cycle. Shared save/saving, navigation titles, saved-state and action resources retain a single registration source.

The combined changes preserve permission guards, tenant/request identity, routes and payloads, file objects, raw authored organization/brand/banner text, grant/tool/approver identifiers, recommendation snapshots and notes, canonical selection/order/colors, and existing normalization. Locale is absent from load/effect dependencies and component keys. Captured failures resolve with the current locale; function-valued React state uses wrapped setters. Submitted-invalid HOME state retains the submitted snapshot. Interpolation remains single-pass, so brace-containing raw values are not reinterpreted. Locale-sensitive grant date rendering preserves the timestamp instant.

The HOME inactive-panel fix selects one display class while retaining mounted children; preview behavior is unchanged. The later explicit preview sentence separator is present. No permission or API/controller change is introduced by this PR delta. The only API-side delta is the tenant-scoped pre-existing grant fixture; it does not manufacture approval-creation or tool-execution evidence.

## Evidence truth and remaining gates

Both previous PROFILE locator findings are addressed in the current browser source: saved feedback uses the actual test ID and denial assertions include StateShell's localized layer prefix. The HOME browser source includes the six real inactive-panel visibility assertions covered by its scoped fix review. Historical logs record each individual registered journey passing 1/1; those logs were read, not regenerated here.

Historical PROFILE browser evidence identifies source `3829bc44…`; HOME final browser/QA identifies `95bf3f27…`. HOME's later spacing-only change has its separate semantic RED/GREEN receipt and was explicitly not rerun through the full browser. Preservation of the accepted `0802a91b…` product tree does not make every current byte identical to every older browser snapshot. The integration README's no-new-combined-browser boundary is appropriate when read together with these source-specific receipts.

No new combined browser run is claimed or required by this review's assignment. Historical geometry coverage remains 375/1280; 820 remains visual-only. Exact rejection HTTP 415, native IME, all pointer inertness paths, approval creation, subsequent real tool execution, and production release are not established by these receipts.

Fresh integration types, the relevant unit/regression union, init/static gates, source CI and native-candidate CI remain pending at review time and belong to the root's serialized validation window. Expected test counts are plans, not evidence of execution. Local Git ancestry does not establish that PR #6203 is merged into develop or that CI is green.

Only this report was written. No tests, browser, services, database, heavy validation, CI dispatch, source edit, Git mutation, push, or subagent was run. Static Git/blob reads and AST inspection were the only mechanical checks performed.
