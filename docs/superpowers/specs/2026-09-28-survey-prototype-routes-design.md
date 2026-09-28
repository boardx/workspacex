# Survey prototype routes and workspace design

Status: proposed for human review. Related issue: #4542.

## Intent and scope

Bring the existing survey system into alignment with the supplied prototype. The normal journey is **design questionnaire → publish and collect → review responses**. AI-assisted creation alone adds **import content → review/correct Markdown** before design. Blank and template creation enter design directly. Question and report templates, and report generation, remain optional destinations rather than mandatory workflow steps.

The existing production implementation, API, published snapshots, and canonical Markdown documents are inputs to this refactor, not disposable scaffolding. Work is split into issue-sized PRs with real browser/API evidence. No unrelated survey feature expansion or permission-model change is part of this design.

## Route model

| Destination | Canonical URL | Notes |
| --- | --- | --- |
| Survey library | `/studio/survey` | Secondary navigation: survey list, questionnaire templates, report templates. No status filter or top-right Markdown import. |
| AI import and proposal review | `/studio/survey/new/import` | Only AI creation enters this path. The proposal is editable Markdown and must be explicitly applied. |
| Designer | `/studio/survey/[surveyId]/design` | Blank/template creation enters here. Three-column desktop workspace; mobile panels open on demand. No AI generation card or raw questionnaire Markdown editor in the design canvas. |
| Collection | `/studio/survey/[surveyId]/publish` | Publication state, collection settings, sharing, true metrics and recent activity. |
| Responses | `/studio/survey/[surveyId]/responses` | Search, filters, pagination, review and export. |
| Response detail | `/studio/survey/[surveyId]/responses/[responseId]` | Stable deep link to one response; may render as an adjacent panel on desktop. |
| Optional report | `/studio/survey/[surveyId]/report` | Accessible from responses and library; not a fourth mandatory step. |

Questionnaire and report template libraries may retain their existing separate routes. Their navigation labels and presentation must follow the prototype, without inserting templates into the three-step progress indicator.

An existing `/studio/survey/[surveyId]?step=design|publish|responses` URL redirects to the corresponding canonical route, preserving `projectId` and other explicitly supported context. Unknown steps land on design. The existing `?preview=1` prototype entry remains available during migration, then may be removed only in a separately reviewed cleanup.

## State and data boundaries

- Routes identify durable destinations. Selected question, open settings panel, transient creation-dialog state, and list filters are local or query state, not separate pages. A response ID is durable and deserves its own route.
- The current `LiveSurveyWorkspace` mixes navigation, data loading, editing, publication and reports. Split reusable domain state/actions from route-specific views. A shared survey layout can own navigation chrome; each page owns its loading, error and empty state. Do not introduce a second mutable copy of the questionnaire.
- Canonical Markdown remains the survey design source. AI produces a proposal, not an automatically published questionnaire. Applying it updates the editable draft through the existing parser and version-checked API. Published design and success-page Markdown remain immutable snapshots for existing responses.
- Blank/template creation must create an independent draft. Template content is copied, not shared as a mutable object. Anonymous one-response-per-browser remains server-enforced as agreed; no cross-device uniqueness is implied.
- Unsaved-navigation protection covers route transitions. Autosave remains limited to eligible unpublished drafts. Stale version conflicts must be visible and recoverable, not overwritten silently.

## Visual and interaction acceptance

1. Library: prototype hierarchy, card information, tags, template navigation and creation modal; real counts and empty states.
2. AI import: dedicated input screen and proposal-review overlay with Markdown/render preview, source summary, regenerate/edit/apply/back actions.
3. Design: toolbox, cover, section/question cards and settings inspector; add/edit/reorder/duplicate/delete/options/required interactions; responsive panels.
4. Publish: status card, settings, collection metrics, sharing link/QR, recent submissions and stop/restart behavior driven by persisted data.
5. Responses: adjacent list/detail, review status, per-answer content, export, empty and failure states.
6. Optional report: template selection/editing, generation and export, without blocking the primary journey.

Each view is compared with the supplied prototype at desktop and mobile widths. Screenshots alone are insufficient: actions must round-trip through API/database and survive refresh and direct-link navigation.

## Delivery sequence and verification

1. Reconcile phase-09 UI/use-case/API contract and feature list with this design; obtain human signoff and phase coherence confirmation. Do not self-sign.
2. Introduce canonical routes and legacy redirects without changing survey semantics. Verify direct URLs, browser history, project context and unsaved navigation.
3. Align library/create and conditional AI import views.
4. Align designer and its question/settings interactions.
5. Align publication/collection and response review.
6. Align optional template/report views.
7. Run targeted UI/API tests, source/version regressions, full browser journey and screenshot comparisons; repair CI/review findings on each PR before treating it as mergeable.

Each implementation slice gets its own issue and PR. The current phase's `passing` state is not edited by hand; harness verification and merge evidence determine completion.

## Explicit open gate

This document is a proposed design, not a substitute for the repository's human three-part contract signoff. Implementation must wait for the updated UI, use cases, API contract and phase coherence review. Existing signoff metadata and section bodies disagree; the discrepancy must be resolved by the human reviewer rather than inferred from the frontmatter alone.
