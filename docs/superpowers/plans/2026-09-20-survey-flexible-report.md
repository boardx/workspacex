# Survey flexible report implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace fixed survey report examples with configurable, data-bound report blocks, then connect the survey lifecycle to durable services.

**Architecture:** Contracts own template validation and deterministic compilation. A shared report document renders compiled blocks for preview and final reports. Survey services own permissions, optimistic versions, publication snapshots and response persistence.

**Tech Stack:** TypeScript, Zod, React, Next.js, existing API/PostgreSQL architecture.

**Spec:** ../specs/2026-09-20-survey-flexible-report-design.md

## Global Constraints

- Do not edit historic signoff states, fabricate responses, targets or benchmark values.
- Default statistics exclude review responses; do not expose individual answers in aggregate reports.
- Shared contracts and rendering define report structure once.
- JSON import is validated; no raw HTML or executable template content.
- Keep each independently reviewable delivery tied to its issue and verified PR.

## Review Focus

- Deleted bound questions produce block issues rather than silently different statistics.
- Review-only/empty answer sets produce no numeric conclusion.
- Copies receive new identities so editing one cannot change another.
- Small grouped samples cannot be inferred from chart rows.
- Template edits do not silently alter an existing generated report.

## Task 1: Template contract and compiler

Files: packages/contracts/src/survey-report.ts, packages/contracts/tests/survey-report.test.ts; export through survey.ts.

- [x] Add schemas for ordered sections/blocks and compileSurveyReport(template, questions, responses).
- [x] Test empty inputs, invalid scale answers, unknown questions, duplicate identities, missing targets and suppressed groups before implementation.
- [x] Compile only actual validated answers; return per-block issues and typed rows.
- [x] Run `pnpm --filter @repo/contracts exec vitest run tests/survey-report.test.ts` and typecheck.

## Task 2: Block editor and shared preview

Files: apps/web/components/survey/report/*, apps/web/components/survey/workflow/report-template-step.tsx; tests/ui/survey-flexible-template.test.tsx.

- [x] Implement immutable add/copy/remove/reorder operations with stable IDs.
- [x] Bind title, text, questions, method, group, target and safe image configuration to template state.
- [x] Render compiler output using the same document component used by the report.
- [x] Verify keyboard reorder, copy isolation, empty template, readonly and invalid JSON import.

## Task 3: Durable survey flow

- [x] Locate existing permission/store conventions before defining route contracts.
- [x] Specify and test versioned create/read/update, frozen publication and idempotent public submission; no mock fallback.
- [x] Implement PostgreSQL storage with organization isolation and current actor guards.
- [x] Connect existing pages to persisted state and show only actual server success.

## Task 4: Report snapshots, exports and full journey

- [x] Store compiled result with template and answer-set revision.
- [x] Use the same ordered blocks for final display and document exports.
- [x] Exercise independent answer submission and report generation in browser; confirm real persistence and exported values.
- [x] Run relevant contracts/API/web suites, lint, typecheck and independent review before PR.
- [ ] Create PR and track CI to green.

## Verification and remaining scope

Implemented the personal-owner lifecycle and configurable report blocks. AI suggestions, project sharing, reusable question/template resource libraries and QR codes are not included. Issue #3754 remains open for these follow-ups.

Evidence: `docs/evidence/survey-3754/README.md`. No production deployment or production data migration has been performed.
