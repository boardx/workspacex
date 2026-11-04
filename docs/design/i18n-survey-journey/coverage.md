# B6 internationalization review surface

Source branch worker/i18n-survey-journey-6221 @e6dc452f7fd14d3f6f7a3e57dc8f7fd04516deb0. Current full/source diffs are derived from the named Git source, with runtime API/contracts unchanged and the6239 diagnostic test removed. Source-only review excludes evidence; no attachment parser/decoder implementation belongs to B6. These artifacts are review views, not completion evidence.

| Surface / actual route | Fixed UI scope | Current verification boundary |
|---|---|---|
| /studio/survey | library tabs/search/tags/status/cards/menu/delete/create/import entry | component tests+whole-source review; actual library375/1280 viewed |
| /studio/survey/[surveyId]/design | all31question types/editor/settings/advanced/logic/preview/Markdown/mobile panels | unit/exhaustive metadata tests; actual raw edit/save/reload/focus/selection and selected375/1280 captures |
| /studio/survey/[surveyId]/publish | schedule/collection state/anonymity/settings/share/QR labels/clone draft | unit+static; actual draft publish201 and anonymous validation reached; screenshots settings375/1280 viewed |
| /surveys/[token] | anonymous language switch/required/format/upload/pending/retry/submit/success chrome | unit+static; actual load/required-validation reached; upload/submit still blocked by6239, noPG claim |
| /studio/survey/[surveyId]/responses | filters/details/raw exclusion reason/review/audit/download | unit+static; real governance and PG still unrun |
| /studio/survey/[surveyId]/report | sample notices/charts/locale format/exports/fixed diagnostics | unit+static/canonical export invariance; real report/download/PG still unrun |
| /studio/survey/[surveyId]/template | report block/chapter editor/save/reuse/unlink/undo | unit+static; real template-case independently ready, no multipart dependency |
| /studio/survey/question-templates/[templateId], /studio/survey/templates/[templateId] | question/report template creation/edit/copy/delete/errors/reuse/raw JSON | unit+static; original independent R1 fixture case remains to execute |
| /studio/survey/new/import | requirements/voice/file metadata/proposal/Markdown apply+explicit recovery | unit+static; original configured-model JSON/base64 case remains to execute; no multipart dependency |

Overlays/native confirmations from actual reachable component graph: CreateSurveyDialog; AI proposal Markdown review Dialog; MarkdownSurveyEditor review Dialog; mobile ResponsiveDesignerPanel Dialog; draft-copy Dialog; SurveyTemplateActions save-as/use-report-template/binding Dialog; native library/template delete, dirty-navigation/remote-reload, report chapter/block delete/import confirmations. Fixed titles/actions/errors use resources; authored input/Markdown/questions/options/answers/template content remain raw. Async error descriptors render with current locale without changing request/CAS/autosave dependencies.

Known non-production boundaries: resource-library mock create dialog and old template shell are not claimed as production route coverage. Configured model execution does not establish external vendor quality; no extra research/ASR/project slices are opened.

Actual prior proof:56files669PASS at ee9b845, separate focused4balanced-matrixPASS at310855, b4db99 current driver webtype0/lint0; no fictitious merged full673 run. Source and remaining-driver reviews are recorded onB6. Complete browser PASS currently0: first-case partial runs produced10+15individually viewed screenshots, no stitching. Corrected driver preserves exactpublish201/requiredmarker/customsuccessraw text. Balanced fixture keeps existing report/threshold with1UI+31API/4groups8, one real rate-window wait under original180s.

Independent remaining cases:
- Template/CAS/copy/reuse/undo/rawJSON: creates its own random SurveyR1 actor+org via surveyAccountFixture inside the case, unique template/surveyIDs and exact PG reader; no result of case1 required.
- Intake/file/proposal/retry: uses canonical configured F.admin, unique UUID draft/title, FileReader→JSON/base64 markdown-proposals, exactly one create/two source writes; no Survey multipart upload or case1 IDs.
Their exact selected results will be reported separately from the original upload/report case, with original180s/worker1/retry0/maxfail1, canonical list proving two titles. No claim of an aggregate three-case native pass.

Latest scope: diagnostic API encoding test removed; production API/contracts match accepted develop cf77 exactly. Upload uses supported ASCII braced filename, preserving Chinese raw bytes; issue6239 is deferred/uncovered. Original template/intake case bodies byte-identical to reviewed7ed. See develop-cf77-scope-proof.json.

Independent selected-two run reached template preview then failed a driver stripped-Markdown assumption. Corrected only to rawBody;3 actual screenshots individually viewed. Intake was maxfail-unrun and will now run under its exact single title. No aggregate three-case pass is claimed.
