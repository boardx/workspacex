# Survey Question Types Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans; bounded module workers own independent components and report back for integration.

**Goal:** Deliver the approved 29 survey answer forms, usable editing/responding, actual validation/statistics, and complete scenario templates.

**Architecture:** Shared version-compatible contracts define the type catalog and validation. Web editing/answering consume that catalog; server validates frozen publication content. Attachments use tenant-scoped metadata, real object storage and transactional response claims.

**Tech Stack:** TypeScript, Zod, React/Next, Nest, PostgreSQL, existing ObjectStore, Vitest/Playwright.

**Spec:** ../specs/2026-09-21-survey-question-types-design.md (approved by user).

## Global Constraints
- Preserve existing single/multi/scale/open questions and string/string[] answers.
- No simulated answers, timestamps, sample counts or report conclusions.
- New forms must support actual persistence, submission, validation and suitable reporting before exposure.
- Preserve published-question locking and existing tenant/owner permissions.
- Uploaded files/signatures require actual bytes and scoped references, not arbitrary URLs.

## Review Focus
- Unanswered numeric sliders and optional values must not become zero or midpoint observations.
- Hidden answers, changed parent cascade values and invalid matrix cells must not survive validation.
- Cross-session attachment reuse, concurrent submissions and expired publication must fail atomically.
- Option renaming and old label-based answers must preserve meaning via versioned publication snapshots.
- Mobile/keyboard use must not depend on drag or horizontally scrolling a matrix.

## Task 1 — Shared question contract, validation and report statistics
Files: packages/contracts/src/survey-question-types.ts; survey.ts; survey-runtime.ts; survey-report.ts; contracts tests.
Exports: createSurveyQuestion(type,id,order), validateSurveyQuestion(q), validateSurveyQuestions(all), validateSurveyAnswer(q,value), visibleSurveyQuestions(all,answers), formatSurveyAnswer(q,value), surveyChoices(q), surveyQuestionStatistics(q).
- [x] Write tests covering every type's valid/invalid answer, frozen IDs, optional blank, visibility and forward-only branching.
- [x] Extend answer union with bounded record<string,string|string[]>; configuration fields are optional for legacy compatibility.
- [x] Implement pure validators/defaults and semantic report statistics: NPS, mean rank, first choice, sum; maintain mean/count/distribution.
- [x] Verify contract tests and typecheck; report count/mean never derives from missing values.

## Task 2 — Editor and actual public answers
Files: apps/web/components/survey/live/question-editor.tsx, public-survey-form.tsx, new focused question components, UI tests.
Consumes Task 1 exports. Upload adapter accepts File and question ID, returns persistent attachment ID/name.
- [x] Test searchable type picker, type-change confirmation, duplication/undo, preview and malformed answers.
- [x] Implement grouped type cards, basic/advanced settings, stable option IDs and bulk option editing.
- [x] Shared answer component renders all types; mobile matrices become per-row fields, ranking offers buttons and keyboard alongside drag.
- [x] Public flow handles visibility, pages and jumps, scrolls/focuses first invalid field and retains answers on server errors.
- [x] Test untapped slider, stale cascade children, matrix missing rows, allocations and keyboard controls.

## Task 3 — Service integration and transactional attachments
Files: apps/api/src/application/survey/survey-service.ts; infrastructure/survey/pg-survey-repository.ts; new attachment service/repository/controller/migration/cleanup; kernel registration.
Interface: SurveyRepository.transact work may return Promise. SurveyTransaction.claimAttachments({publicationVersion,submissionId,uploadSessionToken,responseId,references:[{questionId,attachmentIds}]}) executes inside same TenantSession.
- [x] Replace duplicated publishing/submission validation with shared validators and tests for each type.
- [x] Persist upload session capability bound to publication and submission; verify real file bytes/config/capacity, expose owner-only response download.
- [x] Claim attachment references under the survey transaction before writing response/receipt; reject cross-scope, expired or previously claimed references.
- [x] Test real upload/download bytes, concurrent claim rollback and physical cleanup of expired unsubmitted data.

## Task 4 — Scenario templates and report/answer presentation
Files: apps/web/lib/survey/scenario-templates.ts; builtin-templates.ts; library cards; report template editor; answer viewer.
- [x] Define six distinct questionnaire datasets with meaningful chapters, intro and configured real statistics.
- [x] Separate complete questionnaires from reusable modules in library; derive actual counts.
- [x] Update answer rendering for structured values and attachments; report statistics controls use catalog capabilities.
- [x] Test each complete template publishes, accepts valid fixture answers and compiles sections without fake conclusions.

## Task 5 — Integration, review and delivery
- [ ] Run init baseline, contracts/API/web typechecks, lint and affected tests.
- [ ] Run real local API/Postgres/browser publish→answer→review→report→export evidence across all forms, including mobile and attachment security cases.
- [ ] Independent review, fix findings, commit evidence, push PR linking #3760 and own CI until canonical green.
- [ ] Release owned API/web/compose resources; record unresolved deployment boundary honestly.
