# B6 limited template driver + text-layout review

Immutable context baseline: 62c7637b3dcb0497db4f479c8dbddd5ef4c74167.
Working files reviewed (mode 0644 both), SHA256 recorded before reads and independently rechecked unchanged immediately before report:
- apps/web/e2e/i18n-survey-journey.spec.ts: 64d9e8295e9dd34a82628c50d6a62c0236c1c34bc7d11d5ae9ac76732ab11aa4
- apps/web/components/survey/library/template-workspace.tsx: e0d556e19b96f1848ab0fe4d0afd7a576c78851adbe1c52f7601aaa22382bf13

Verdict: requested two-line delta is statically addressed; no confirmed actionable P1/P2 in the bounded remaining template steps. Runtime still pending. This is not a whole B6 or AI case re-review.

## Exact delta

Actual apps/web working diff against baseline has only these two paths, one replacement line each.
1. Spec :519 now selects button exact “Export template”. Immutable actual FlexibleReportEditor :116 uses survey.results.exportTemplate; EN dictionary :296 is exactly “Export template”. Its download :73–82 serializes JSON.stringify(template,null,2), uses application/json and filename report-template.json. Filename and full raw JSON comparison assertions :521–523 are unchanged.
2. Template header title/status wrapper :213 changes only className from min-w-0 flex-1 to min-w-0 basis-full sm:basis-0 sm:flex-1. Existing parent is flex flex-wrap; at375 the title/status occupies a complete flex row, while >=sm restores flexible desktop sizing. DOM node order/key, text, handlers, heading/status and buttons remain. This avoids sharing a narrow row with back/actions by construction, but actual 375 clipping/overlap still requires screenshot QA; no pixel success is claimed.

## Every remaining template action/name (spec :519–593)

| Spec step | Verified actual source and result |
| --- | --- |
| :519 Export template button | report/template-editor.tsx:116 + survey-results EN:296 exact match; actual download event remains armed before click. |
| :521–523 file name and raw JSON | editor download serializes same saved template with indent2 and report-template.json. No labels are substituted into serialized model. |
| :524 Chapter title textbox/capture | editor :193–197 explicitly aria-label survey.results.chapterTitle, EN:303 “Chapter title”. Fixture creates one chapter and still has editor preview=false; one matching input, no required-marker suffix. |
| :525 Back to template library | template-workspace back button :210–211, survey-templates EN:169 exact. Back :193–195 routes to /studio/survey?tab=modules for question kind. Copy edits were saved; switching report tab/export adds no dirty model edit, so no unhandled leave-confirm expected. |
| :526 copyCard article/raw heading | TemplateLibrary uses ResourceCard pure article and raw item.title heading; ResourceCard default h3 is an actual heading. Copy's unique authored title remains locator identity. |
| :528 Create survey from template | library :262–268 uses survey.templates.createSurvey, EN:149 exact. Actual handler :137–152 POST /surveys forwards item.title/questions/template. Waiter exact method/path agrees. /studio/survey/id route redirects to canonical /design via surveyPath; expected URL and raw copy question assertion match. |
| :532 More actions | live workspace secondary trigger uses survey.workspace.more; EN:189 exact. |
| :533 Design report template (optional) | secondary action uses survey.workspace.designReportOptional; EN:190 exact and selects template step. |
| :534 Save as report template | template step mounts SurveyTemplateActions kind=report. label is survey.templates.reportOne = lower-case “report template”; saveAs = “Save as {label}”, so exact composed button name matches. No alternate legacy/mock editor assumed. |
| :536 Save template name textbox | actions :267–272 explicitly aria-label survey.templates.saveName, EN:210 exact. Raw reportName is entered without translation. |
| :538 Save to template library | actions :275–280 uses survey.templates.saveLibrary while !busy; EN:211 exact. Actual save :115–137 sends POST /surveys/templates with kind/report and draft raw questions/template; closes mode on successful parsed row. Waiter and report kind assertion agree. |
| :541 closed save dialog | Dialog open is mode!==null; successful save sets mode null. No other dialog opened at this point. |
| :542 Use report template | same actual report actions uses use = “Use {label}”; exact composed name agrees and opens use dialog. |
| :544 Select report template combobox/value | native select :303–312 explicitly aria-label select = “Select {label}”; actual option value is source.id. Saving reportSource gives one corresponding row; test selects canonical ID, not localized text. |
| :545–549 Match question / 对应题目 | actions :347–371 iterates requiredTemplateQuestions and aria-label match with raw source question.title. EN:220 “Match question: {title}”, ZH:95 “对应题目：{title}” exactly agree. Fixture report's sole referenced numeric question retains copyQuestion; current same-type option value is survey.questions[0].id. Locale changes only label, not bindings/ID; no required-marker suffix here. |
| :550–552 EN restoration/no calls/capture | locator binding resolves same semantic select after language returns en. Underlying field uses bindings[id] state; source/promotion fetching depends on dialog mode/thread data rather than this display text. Existing no-call assertion remains. |
| :553–555 Apply template + native confirmation | actions :377+ button exact EN:222 “Apply template”, disabled until all refs bound; apply :145–173 checks original type, maps template, calls window.confirm before onApply. page.once(native dialog accept) is armed first. Success closes mode; no fake write introduced. |
| :556–558 Save changes | template apply updates draft only. Live header :419 uses survey.workspace.save = EN:197 “Save changes” when idle/dirty; real save emits PUT /surveys/id/source, matching exact waiter. Assertions remain on actual response.ok. |
| :559–563 template identity/source isolation | actual remapReportTemplate creates new template/section/block UUIDs and maps questionIds to explicit destination. Existing text block0/table block1 fixture order is maintained. Source report template API object is checked unchanged. |
| :565 Unlink report template | action EN:203 exact. Actual action :209–215 makes cleared template and calls onApply(...,'unbind'); parent :552–555 sets autosave draft for that action, preserving existing real source PUT. Empty sections assertion agrees. |
| :569–572 locale + Undo unlink | canUndoUnbind depends on cleared ID/title/empty sections, not translated label. EN:204 exact “Undo unlink”; no locale-induced request expected. |
| :573–577 Undo unlink write boundary | actual action :217–223 restores structured-cloned prior template and invokes 'undo-unbind'; same parent autosave emits PUT source. Original full applied.template equality remains. (It is PUT, not POST; no API command changed.) |
| :578 Body textbox/capture | restored report has one text block; editor :419–424 explicitly aria-label survey.results.body, EN:315 “Body”. Restored template remains in same template step and first/sole chapter; no modal/hidden duplicate is created. |
| :579–586 PG/raw/callback checks | same owned account.userId/survey.id and original/copy/reportSource IDs go to existing reader. Full restored template/questions and all3 raw persisted template rows, no page errors, receipt IDs/version/hash and no duplicated create/write assumptions remain unchanged. |
| :587–593 finally | original held-response disposal, locale companion close and owned fixture cleanup remain. No budget/retry/worker/assertion removal. |

Original three 180000ms case budgets unchanged. No runtime/parser/encoding/API/non-i18n behavior change proposed or reviewed. Prior raw-Markdown/export-name misses are not treated as label evidence: all names listed above were read directly from immutable actual renderers and resource values. Earlier AI PASS was not re-reviewed. No tests/type/lint/init/build/browser/network/raw trace or private logs run/read; no source/index/branch mutations. Only this private report written.

## Late supplied matrix cross-check

Read the owner task-7/template-remaining-source-matrix.md and its hashes JSON after the independent renderer/resource audit above. Its twenty rows agree with the actual source names/actions checked here; author image/snapshot descriptions were not independently visually accepted. All twelve listed file hashes match actual reads; the two WIP file hashes/modes remain unchanged at final read. No new finding. Recorded context bindings:

- apps/web/e2e/i18n-survey-journey.spec.ts: 64d9e8295e9dd34a82628c50d6a62c0236c1c34bc7d11d5ae9ac76732ab11aa4, mode 0o644
- apps/web/components/survey/library/template-workspace.tsx: e0d556e19b96f1848ab0fe4d0afd7a576c78851adbe1c52f7601aaa22382bf13, mode 0o644
- apps/web/components/survey/library/template-actions.tsx: 3616d2d80f3fe7b39de84781823b6dc17dc02d9cfbb9aae28ec0094c4362b121, mode 0o644
- apps/web/components/survey/library/template-library.tsx: 5991cedf107a171ab4f4f1993baf18c34bd2787c758d89680b7d50ab2b6cd473, mode 0o644
- apps/web/components/ui/resource-card.tsx: a4b532da0e0d3db47ac0363b6a47e34e90e6a4b68afeb377bdd74856ca209b68, mode 0o644
- apps/web/components/survey/report/template-editor.tsx: e7dcaf29f7e434e9c8bc9c6d40cf057a8f353f59cf8d00177bf989f1f3621ba9, mode 0o644
- apps/web/components/survey/live/survey-workspace.tsx: 969999cd4de5080d4d832545825548560985c334dd5f05a018895590be935103, mode 0o644
- apps/web/lib/survey/template-reuse.ts: 3aedb464a916ba3a07e3c1e7a832bc82a92657b04b29614efd3e866124f8fb69, mode 0o644
- apps/web/lib/i18n/namespaces/survey-templates.ts: 4f526b4180aca338f35e7ab350f4a89af0a277741f7fa88157504ce95a636efd, mode 0o644
- apps/web/lib/i18n/namespaces/survey-results.ts: 4aa27e8eb07e1c149dfa8933b77b84c21b797f8a6fce74b7caca872fc6aae700, mode 0o644
- apps/web/lib/i18n/namespaces/survey-workspace.ts: 458da8b031e5b889ad5970c96f2a3d8e09fdec69d62a8864f05de12d86552eeb, mode 0o644
- apps/web/tests/ui/survey-report-editor-i18n.test.tsx: 9461a590d9255ea6bb498062f1a1057464560f831adead528f77c2323c33ac8c, mode 0o644
