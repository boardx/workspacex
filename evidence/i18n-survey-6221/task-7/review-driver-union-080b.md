# Limited static driver/merge review

Base: ee9b845a1090082251563c48a2791d1034ff7cb7
Head: 080bbba0ee858525f57fedefe42fa68ea938d91b
Worker checkpoint: 7a35864b274146a804c24c57d9221e022f43e210
Accepted merge parent: b992054dd498530092d09a1fa559f0b12a33406b

Verdict: STATIC CLEAN for the requested driver and merge-union scope. No confirmed actionable Critical/Important/P1/P2 findings.

## Source checks
- Exact HEAD spec is byte-identical to worker checkpoint. Relative to ee9b, its sole own source change is apps/web/e2e/i18n-survey-journey.spec.ts; accepted upstream domain changes were not re-reviewed.
- Line 97 scopes to the last main, including hidden main. Survey public/template components render their own main; the shell does not add a later main. Installed Next announcer implementation appends its container directly to document.body, outside this main.
- Lines 202-206 and 447-452 require exactly one visible product validation/permission alert before checking its text. Selector population is not filtered by English message text, so untranslated or unexpected extra product alerts do not disappear from the count.
- Lines 635-650 locate Markdown dialog by stable role/count and explicitly assert EN/ZH accessible names across locale switches. Original Markdown value, editor element/focus, selection and no-extra-write checks remain.
- Lines 666-675 require one visible dialog error, plus exactly two retained inline errors inside hidden main, checking each message. Static component composition supports this: ai-proposal has one inline error; parent survey-import-workspace has another; DialogContent uses a Portal outside main, so the visible dialog error is not counted twice. DOM timing/visibility remains runtime-unverified.
- Draft precondition remains. Exact POST /surveys/${id}/publish waiter now checks status 201 and ok(). All three 180000ms case timeouts and other original business assertions remain. No worker/retry override is introduced. Config keeps existing inherited CI retry=1 default; a retries=0/worker=1 actual run must remain an explicit runner fact, not be inferred from this spec.

## Merge checks
- HEAD has actual parents worker checkpoint and accepted b992.
- Independently compared complete git tree mode/blob entries against common base ddf28f7e: 174 worker-only paths, 87 upstream-only, exactly three overlapping paths (EN registry, ZH registry, fullstack config). Every non-overlap mode/blob retained exactly; zero mismatches.
- Both registries independently match exact parent union of import/literal-entry/spread lines, no missing or extra nonstructural entries. Pure namespace blobs are covered by mode/blob preservation.
- Fullstack config differs from worker only by accepted combined fixture import, fifteen exact accepted fixture environment fields, and blank separator. Original survey registration occurs once; existing commands/budgets/workers/retry settings remain.
- Read only the three allowlisted uncommitted task-7/develop-b992 proof JSON files in FIRST existing WT /Users/shenyangjun/boardx/workspacex. Their exact SHA bindings and stated preservation match these independent checks. They remain working-file metadata, not HEAD-tree evidence. No raw artifact or credential value was read/output.

## Declined to judge / boundaries
- Accepted upstream domain behavior: already accepted and explicitly outside this incremental review.
- Full B6 source, historical evidence/security, image QA: not re-reviewed in this limited delta.
- Fresh browser, actual accessibility runtime, API/PG/model behavior, current type/lint/resource gates and retries=0/worker=1 runner execution: not run or independently accepted here. No dynamic PASS, final delivery, or all-CI-green claim.

Only exact git object reads, limited static scripts and designated proof reads were used. No tests/type/lint/init/build/browser/network/services or source/branch/index changes.
