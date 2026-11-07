# Concentrated three-case static driver review

Exact SHA: 111cadb1cda07a552d1797c3d1007fd088aece8f.
Review used exact git object source, actual renderers/contracts/controllers, and only safe task-7/browser-second-{diagnosis.md,cleanup.json,screenshot-qa.json}. No private trace/context, browser, network, test, type, lint, init or source mutation.

## Verdict / material finding

**P2 — repeated supplemental answers cannot unlock the report export gate.**
Location: apps/web/e2e/i18n-survey-journey.spec.ts:315–333 (especially 316,323,332).
Trigger: first case reaches the supplemental-response phase. Every supplemental response copies the original duration answer, which fillMeeting sets to “合适”. Meeting scenario has four duration options and scenarioTemplate chooses distribution/bar for that single-choice question (apps/web/lib/survey/scenario-templates.ts:244–251,353–374). It remains in the report; the driver only changes the first responses block to bind the file.
Evidence: packages/contracts/src/survey-report.ts:522–537 emits one distribution row for every option, with row.count equal to that option's answer count; three duration option rows therefore have count 0. Its existing share gate at :176–185 takes the minimum of every block's row counts and rejects values below SURVEY_REPORT_SHARE_MIN_SAMPLE. All copied answers increase only “合适”; total included count reaching the threshold does not satisfy output privacy. survey-workspace.tsx binds export disabled to this reason. Consequently lines 332–333 will time out, before Markdown/Word downloads and final PG/chart assertions. This is a deterministic driver/data-fixture contradiction, not an i18n regression.
Fix: preserve the low-sample disabled proof and existing privacy gate. Through the real editor configure a report whose outputs can meet the threshold (while retaining intended chart/raw-answer coverage), or submit sufficient real samples for every emitted option group and update total-response expectations accordingly. Merely adding identical samples, increasing timeout/retries, or weakening export assertions will not resolve it.

No other confirmed actionable P1/P2 found in this static pass. This is not a CLEAN verdict for the complete current driver because of the finding above.

## Step-by-step checklist against actual implementation

Status below means static agreement, not runtime PASS. Paths are under apps/web unless noted.

### Case 1 — author/public/upload/governance/report (spec 119–382)
| Step | Static cross-check / outcome |
| --- | --- |
| Owned actor login and locale companion | survey-owned-organization fixture seeds unique Survey R1 actor; login uses its account. PG helper strips the same canonical user prefix and script derives the exact personal-local org/owner. Login and locale-event execution remain dynamic-unverified. |
| Meeting library card and create | builtin scenario title and real card action match; create POST /surveys and design route agree with library/router. |
| Raw survey title and first question edit | live workspace named input and canvas edit buttons match; raw values and source equality assertions retained. |
| File question append and optional toggle | question picker testid add-question-file and editor labels match; ninth question follows eight scenario questions. Runtime poll proves raw title/required=false persistence. |
| EN/ZH focus/selection, reload | stable input handle/focus/selection and no-survey-request/source equality checks remain; reload rechecks persistence. |
| Bind file through report editor | first scenario short-answer block supports responses; checkbox label is order + raw title. Real source PUT/save and publish-readiness assertion retained. |
| Publish surface and draft prerequisite | numbered step label is rendered by workspace nav; Start collection chooses publish for draft. Exact POST /surveys/id/publish expects 201 and ok; snapshot/batch captured. |
| Anonymous form and validation | public form main renders raw h1; language control and submit names agree. Exactly one visible main-scoped alert checked, excluding body-level Next announcer. |
| Meeting answers | first/open/date controls explicitly aria-label raw title, without required suffix. Required fieldset legend includes title + “ *”; four scale groups count five radios and select/check fourth; duration exact required name and raw “合适” choice now agree. |
| Upload session pending and locale | public form first POST /public/surveys/token/upload-sessions body submissionId matches held endpoint. Material input is Choose file. While held, uploading counter disables submit; locale retains raw answer and request count. |
| File upload completion | actual next POST is /public/surveys/token/upload-sessions/session/questions/questionId/attachments. Material awaits upload response.ok and appends returned attachmentId/name. Filename and enabled submit reflect completion; final PG metadata and authenticated download SHA validate actual bytes. No exact upload HTTP status assertion is claimed by this driver. |
| Submit identity and authored success | exact public responses POST; submissionId equals upload session's. Publication parser obtains unchanged canonical default plain Chinese successMessageMarkdown. ReactMarkdown renders that default as the same visible text; status equality across both locales now agrees. This comparison would need rendered-text semantics if the fixture later explicitly authored formatted Markdown; current fixture does not. |
| API/PG persistence | saved response answers, publication and batch preserved. SELECT reader scopes exact owned org/owner/survey before derived tables, compares questions/responses/source/upload relation and attachment hash. No token/proof fields output. |
| Authenticated download | controller GET /surveys/id/responses/responseId/attachments/attachmentId/content matches; response.ok and bytes SHA retained. |
| Response review/exclude/include | actual labeled section has role region; Reason for exclusion and both analysis buttons match; PATCH endpoint and version command match. Raw reason, locale no-request and two history entries retained. |
| Open report optional group and generate | details has aria-label, implicit group; summary opens it; Generate analysis report selects report step, then Generate report POST /surveys/id/report. Generated-at, sample summary and Low sample notice match actual report renderer. |
| Low-sample export disabled | both export buttons use reportShareBlockedReason and are expected disabled. Preserved. |
| Supplemental responses and regenerate | fresh anonymous request contexts first GET public form to obtain proof cookie, then submit genuine responses; no file replay. Exact report POST matches. **Contradiction: output option-group counts remain below privacy threshold despite total included count.** |
| Markdown/Word + final chart/PG | selectors/filenames and pure canonical Markdown exporter match; Word OOXML checked independently. Original suggestion, locale-invariant Markdown, publication/batch, governance history and API/PG report checks retained. These steps remain unreachable under current supplemental data. Duration distribution supplies intended bar chart/data-chart SVG, but also causes the export gate finding. |

### Case 2 — question/report templates (spec 383–582)
| Step | Static cross-check / outcome |
| --- | --- |
| New template EN defaults | template workspace newDraft uses current translator, new question-template route and name/description inputs agree. |
| Add number question | overview Add question opens picker; Number label plus description supplies regex name; Question content named editor matches. |
| Add report chapter/text/table | Report settings tab mounts FlexibleReportEditor; exact Chapter title, Add Text note/Data table and Body names agree. Last block is table; raw question checkbox uses order/title. newBlock starts mean; number supports mean, so assertion is consistent. |
| Description locale/focus/no requests | same textarea handle and raw value retained. No API-changing locale dependency introduced by driver. |
| Preview/back | FlexibleReportEditor toggles preview; compiled text block renders authored bold text as expected visible text. Back to editing restores fields. |
| Initial POST held/save pending | actual POST /surveys/templates carries kind/title. busy renders localized saving and disables fieldset/button; locale checks no duplicate calls. |
| Save accept/route/reload | schema parsed row, real route replacement, current version/source read and raw description reload agree. |
| Controlled PUT failure and explicit retry | exact own template route; only first PUT fulfilled 403. Main-scoped alert count/visible and retained description checked. No sign-in fallback/raw reason leakage. Retry body equality and expectedVersion/version+1 checked. |
| Copy and independent edit | save(true) POST suffix is “ copy” in en; questions/template preserved, new row ID, route resets questions tab. Overview Edit question 1 opens correct content; PUT only copy, original API object checked unchanged. |
| Canonical JSON export/back/library | report tab export serializes template with same indent and filename. No edits after saved copy, so back navigation does not require unsaved confirmation. Copy card create action sends real survey POST and routes to design. |
| Save report template | workspace report editor exposes SurveyTemplateActions kind=report; save dialog name/save button and POST match. |
| Apply report template and locale bindings | Select report template native select and Match question raw name agree. Binding targets canonical current ID, locale persists value/no calls. Apply asks one native confirmation, remaps template/block IDs and questions; real subsequent source PUT/save checked. |
| Unlink/undo | report actions invoke existing auto-save source PUT callbacks. canUndoUnbind matches cleared draft ID/title/empty sections, preserved across locale. Undo restores exact prior template. |
| Final raw API/PG proof | exact original, copy and report template IDs passed to owned reader; restored questions/template and all three persisted rows compared, no derived display values substituted. |

### Case 3 — configured AI/file import (spec 583 onward)
| Step | Static cross-check / outcome |
| --- | --- |
| Fixture actor and new survey | configured fullstack admin account is intentionally separate from owned PG cases; no false PG claim. Primary create testid, New survey dialog, name and AI radio prefix match. |
| Locale before create/Next | AI mode closes dialog and navigates to draft import without POST; original no-write assertions match implementation. |
| Requirements and file | named textarea, Upload survey file hidden input, filename and generate button match. FileReader passes exact base64; raw requirement/file name and decoded SHA asserted. |
| Generate pending | POST /surveys/markdown-proposals exact held route; actual busy/disabled and localized labels match; no duplicate writes on locale. |
| Proposal result | response.ok, nonempty markdown, configured provider/model and file source kind asserted. Does not establish vendor quality or semantic correctness. |
| Markdown dialog identity/focus | one visible portaled dialog by stable role, EN/ZH accessible name from DialogTitle; raw edited Markdown, same editor handle/focus and no-write locale checks match. |
| First apply and controlled source failure | actual import apply creates once, retains created-id, then PUT source. Exact first source PUT receives 403; child and parent store error, giving one visible dialog alert plus two hidden main inline alerts; all messages checked. |
| Explicit retry | unroute then retry uses GET existing survey (no second POST), same canonical template serialization, source PUT and router replace. Raw original draft title overrides model title by design; template identity checked against partial API row. |
| Reload/final write counts | persisted one raw question/source plus raw title, edit selector and reload agree. Exactly one proposal, one create, two source attempts maintained. No product retry or budget changed. |

## Budgets and evidence boundaries
- Three 180000ms case timeouts retained; no timeout/retry or worker relaxation in this change. worker=1/retries=0 are actual runner requirements, not inferred from the spec (base config retains CI default retry=1 unless explicitly overridden).
- Safe second-run diagnosis explicitly states timeout/zero passes/two unrun under max-failures1 and no mutation receipt; only pre-upload state reached. Cleanup JSON reports zero owned containers/volumes/listeners. Screenshot manifest assigns QA to author and says wholeJourneyQaPassed=false; this reviewer did not view private PNGs or trace.
- Not repeated: prior whole-source i18n review or accepted unrelated upstream changes. Actual locale events, accessibility names in a browser, model response, timing, uploads, API/PG execution, Word/downloads and complete three-case duration remain dynamically unverified.
