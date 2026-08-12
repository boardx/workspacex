# Personal Transcription Single Body Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace personal transcription segment rendering/storage with one editable, copyable persisted body.

**Architecture:** `personal_transcriptions.content` becomes the only transcript body for the personal surface. The provider gateway atomically appends each final result through the repository, while a new owner-only PATCH operation replaces content only when no capture is active. Existing personal segments are folded into content by migration; project recordings retain their segment model.

**Tech Stack:** TypeScript, Zod contracts, NestJS, PostgreSQL, React, Vitest.

## Global Constraints

- No new dependencies.
- Do not expose or persist interim results.
- Do not change project recording segment behavior.
- Do not permit content replacement while a capture is active.
- Keep one Delivery PR: F167 / issue #1069 / PR #1076.

---

### Task 1: Contract the single-body surface

**Files:**
- Modify: `packages/contracts/src/personal-realtime-transcription.ts`
- Modify: `packages/contracts/tests/personal-realtime-transcription.test.ts`

**Interfaces:**
- Produces: `PersonalTranscriptionDetail { ...summary, content }`
- Produces: `operations.updatePersonalTranscriptionContent` with `{ sessionId, content }`

- [ ] Add failing contract tests for `content`, PATCH, and absence of `captures`.
- [ ] Run the focused contracts test and confirm RED.
- [ ] Implement the schemas and operation.
- [ ] Run the focused contracts test and confirm GREEN.

### Task 2: Persist and update one body

**Files:**
- Create: `apps/api/migrations/20260812113000_f167_personal_transcription_content.sql`
- Modify: `apps/api/src/application/recording/personal-transcription-ports.ts`
- Modify: `apps/api/src/application/recording/personal-transcription-usecases.ts`
- Modify: `apps/api/src/infrastructure/recording/pg-personal-transcription-repository.ts`
- Modify: `apps/api/src/interface/controllers/recording.controller.ts`
- Modify: relevant personal transcription repository and HTTP tests

**Interfaces:**
- Produces: `appendFinal(...)` atomically appends to `personal_transcriptions.content`.
- Produces: `replaceContent({ orgId, ownerUserId, transcriptionId, content })`.
- Produces: owner-only PATCH controller response parsed by the contract.

- [ ] Add failing repository/use-case/controller tests for append, replace, active-capture rejection, and owner isolation.
- [ ] Run focused API tests under the isolation wrapper and confirm RED.
- [ ] Add migration and minimal repository/use-case/controller implementation.
- [ ] Run focused API tests and confirm GREEN.

### Task 3: Render, copy, and edit the single body

**Files:**
- Modify: `apps/web/components/rec/realtime-transcription-workspace.tsx`
- Modify: `apps/web/components/rec/transcription-history.tsx`
- Modify: `apps/web/tests/ui/realtime-transcription-workspace.test.tsx`
- Modify: `apps/web/tests/ui/personal-transcription-history.test.tsx`

**Interfaces:**
- Consumes: `PersonalTranscriptionDetail.content`.
- Consumes: `PATCH updatePersonalTranscriptionContent`.
- Produces: `rec-live-copy`, `rec-live-edit`, `rec-live-editor`, `rec-live-save` controls.

- [ ] Add failing UI tests for one body, no timestamps/cards, copy, edit/save, and recording edit lock.
- [ ] Run focused UI tests and confirm RED.
- [ ] Implement the minimal workspace and coordinator changes.
- [ ] Run all F167 focused frontend tests and confirm GREEN.

### Task 4: Verify and update the existing Delivery PR

**Files:**
- Modify only F167 evidence/PR metadata required by harness.

- [ ] Run contract, focused API, frontend, and migration verification.
- [ ] Run `git diff --check` and inspect scope.
- [ ] Amend the F167 commit and update PR #1076.
- [ ] Record exact results on issue #1069 without marking the feature passing before merge.
