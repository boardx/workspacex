# Survey Markdown Workspace Redesign

## Goal

Replace the current mock-driven five-step survey experience with a coherent,
production survey workspace that follows the approved prototype direction. The
primary path must be easy to understand and complete:

```text
Design survey -> Publish & collect -> Review responses
```

Templates and analysis reports are optional accelerators; they must not become
required workflow stages. Survey content is authored and persisted as Markdown,
then compiled server-side into the structured revision used for preview,
publication, response collection, and reporting.

## Confirmed product decisions

1. Keep the WorkspaceX global navigation. Remove only the survey module's
   secondary left navigation (survey list, question modules, report modules).
2. The three primary workflow stages are `design`, `publish`, and `responses`.
3. A survey template, report template, and analysis report are optional
   capabilities accessed from contextual actions, not primary stages.
4. Markdown is the single editable and persisted source of survey structure.
   Structured editor panels and respondent-facing survey views are projections
   of the same compiled source, never a parallel UI-only model.
5. Existing survey, publication, and response data must remain usable. A
   migration or parsing failure must not overwrite an existing published
   revision or historic answer.

## Current-state diagnosis

The present survey routes are wrapped by `SurveyAppShell`, which renders a
secondary resource side navigation. `SurveyResourceLibrary` and
`SurveyWorkflowShell` use `SURVEY_LIBRARY_CARDS` and
`createSurveyWorkflowMock`; the existing five-step UI therefore cannot be the
source of truth for real surveys. It also exposes report templates as a stage
between design and publication, which conflicts with the approved three-step
mental model.

The source compilation work in `packages/contracts` and the API establishes
the required persistence boundary. This redesign consumes that boundary rather
than adding another document or browser-local structure format.

## Information architecture

### Survey home

`/studio/survey` is the survey home. It has no survey-specific left rail.
The header offers `My surveys`, `Templates`, and `Report templates` as compact
top-level contextual tabs or menu entries, not a permanent second navigation.

The default view displays real surveys as status-aware cards or rows with:

- title and short description;
- draft, collecting, closed, and archived status;
- question count, received response count, valid response count, and update
  time when available;
- one clear next action, such as continue design, publish, or review
  responses.

Search, status filtering, sort order, loading, empty, error, and permission
states are first-class states. The create action offers blank, template, or
Markdown import without sending the user into a separate module workflow.

### Stage 1: design

`/studio/survey/[surveyId]?step=design` is a single-task workspace with a
compact header, explicit save state, preview, and a primary “Publish & collect”
action. It shows a horizontal three-stage progress control only.

The main pane combines Markdown authoring and live survey preview. The
question outline is an on-demand drawer/popover; it does not occupy a fixed
left column. Per-question properties are an on-demand right drawer. AI
generation inserts a proposed Markdown block that the author can inspect and
accept before it becomes the saved source.

The design stage may offer “use template” and “configure report template” as
secondary actions. Neither prevents an author from saving or publishing a
valid survey.

### Stage 2: publish and collect

`?step=publish` is available only for a successfully compiled, publishable
survey revision. It presents readiness checks before the publish action, then
shows the active link, QR code, delivery/channel affordances, deadline,
anonymous and response-limit controls, and collection metrics.

Changing a published survey does not mutate the respondent-visible historic
revision. A source edit creates or updates a draft revision; the UI clearly
states when a republish is needed. Stop collection is an explicit, reversible
state transition with confirmation.

### Stage 3: review responses

`?step=responses` presents real submitted responses in a searchable and
filterable table. Selecting a row opens a detail drawer with submission
metadata, response validity, and answers rendered against the exact published
revision. Users can export authorized response sets and flag a response as
invalid with an auditable reason.

“Generate analysis report” is an optional action on this stage. It is disabled
or explains its limitation when the configured minimum valid sample threshold
is not met. Report pages remain reachable as a contextual subroute, never as a
required stage in the primary progress control.

## Markdown source and server contract

The source contract lives in `packages/contracts/src/survey-source.ts` and
must remain the only shared schema for Markdown source, compilation diagnostics,
and structured compiled output.

1. Fetch returns current draft source, source revision/version, compilation
   result, and the latest published revision reference.
2. Save accepts Markdown plus the expected version. The server validates and
   compiles it atomically, returning diagnostics without replacing a valid
   stored draft on a compiler failure.
3. A version mismatch returns the current remote source and revision metadata;
   the client gives the author a compare-and-resolve experience rather than
   discarding local text.
4. Publish accepts only a valid compiled draft and records an immutable
   respondent-facing revision. Source edits after publication make that draft
   “needs publish” without changing existing answers.
5. Template application produces Markdown that is attributed to its template
   source. Report configuration remains Markdown-compatible and is compiled
   through the same server-owned path.

No browser-only mock model, duplicate question schema, or URL-encoded creation
draft becomes a persistence source.

## Component boundaries

| Unit | Responsibility | Depends on |
| --- | --- | --- |
| `SurveyWorkspaceShell` | Global-shell integration, no local secondary rail | app shell and route context |
| `SurveyHome` | Real list, search, filters, contextual template entry points | survey query client |
| `SurveyStageNav` | Three-stage state and permitted transitions | survey lifecycle view |
| `MarkdownSurveyEditor` | Draft source, compiler diagnostics, save/conflict states | source query/mutation client |
| `SurveyPreview` | Read-only projection of the compiled draft | compiler output |
| `PublishCollectWorkspace` | readiness, lifecycle actions, sharing, recovery data | publish/collection API |
| `ResponseReviewWorkspace` | response table, details, validity action, exports | responses API |
| `SurveyReportWorkspace` | optional report generation/readout | report API and valid response set |

The legacy resource-library and workflow mock modules are removed only after
their real replacements cover the same supported routes and migration paths.

## Reliability and edge cases

- Autosave has visible `saving`, `saved`, `error`, and `conflict` states.
- Compiler errors identify a Markdown location and retain the editor value.
- Loading, empty, error, inaccessible, and archived states appear on every
  page; a failed fetch never looks like an empty collection.
- Published/history-sensitive source changes are constrained to compatible
  operations (hide, branch to a new revision, or create a new question). They
  never rewrite a response's meaning in place.
- Mobile uses drawers for outline/settings and preserves the one-column main
  task. Keyboard focus and screen-reader labels are maintained for all drawers,
  menus, stage controls, and feedback states.

## Delivery sequence

Each increment is one GitHub issue, one feature branch, one PR, browser
verification, and CI-green before it is offered for manual merge.

1. **Workspace and survey home** — remove the secondary rail; add the new
   survey home, top contextual entries, and real list query states.
2. **Markdown design workspace** — replace the mock design step with source
   fetch/save, compiler diagnostics, preview, autosave, and conflict handling.
3. **Publish and collect workspace** — real readiness, publishing, share link,
   recovery controls, and collection metrics.
4. **Response review workspace** — real response list, detail drawer, validity
   action, and export behavior.
5. **Optional accelerators** — template application and report-template entry
   points without changing the primary flow.
6. **Optional analysis and migration hardening** — report generation/readout,
   historic survey source migration, and cross-flow regression coverage.

## Acceptance criteria

1. A user can complete design, publication, response submission, and response
   review without encountering a survey-specific left navigation or a required
   template/report stage.
2. Editing Markdown changes preview only after a successful compiler result;
   invalid source shows diagnostics and does not corrupt the last valid draft
   or published revision.
3. Publishing and respondent response collection use the same immutable
   compiled revision; post-publish authoring cannot reinterpret historic
   responses.
4. The survey home, design, publish, and response pages use real API data and
   present distinct loading, empty, error, and no-access states.
5. Templates and report analysis can be used when desired but are not required
   for a valid primary-flow survey.
6. Browser E2E covers blank creation, Markdown save/preview, publish,
   respondent completion, response review, and optional-report threshold
   behavior. Contract tests cover source version conflicts and published
   revision immutability.

## Non-goals

- Do not hide the product-wide WorkspaceX navigation.
- Do not introduce a second visual-form document model alongside Markdown.
- Do not change existing answer data solely to make it fit the new UI.
- Do not make AI-generated content publish automatically without author review
  and normal compiler validation.
