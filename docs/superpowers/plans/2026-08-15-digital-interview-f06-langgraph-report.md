# Digital Interview F06 LangGraph Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate a resumable streaming Markdown interview report from persisted answers and sources, keep a durable timeline, and export the completed report to PDF and Word.

**Architecture:** The F06 parent-graph nodes prepare evidence, stream Markdown chunks into business tables, finalize a report version, and create export artifacts only after finalization. While generation is in progress the UI renders the Markdown body as it arrives and keeps the right-side timeline; chapter navigation appears only when headings are discovered, not from a speculative outline. PostgreSQL checkpoints resume orchestration, while report Markdown/chunks and export metadata remain in business tables.

**Tech Stack:** TypeScript LangGraph, NestJS, PostgreSQL/PostgresSaver, SSE, Markdown rendering, artifact/file export services, Next.js, React, Vitest

## Global Constraints

- F04 setup and F05 runs must already be merged into `main`; this is a separate F06 issue and PR.
- Report source is persisted answers plus exact source pointers; never synthesize citations to unused material.
- During generation, show normal rendered Markdown text and the durable timeline; chapter navigation is derived from received headings and may initially be empty.
- Every generated chunk is durably stored before its timeline event is emitted.
- Retry/resume must append from the last committed chunk and must not duplicate Markdown.
- A report is exportable only after state `completed`; PDF and Word exports use the same finalized Markdown version.
- Checkpoints contain report/version/chunk IDs only, not full Markdown or binary files.
- Permission is rechecked before evidence load, after model generation, and before chunk/final write.
- All writes use `requestId` and `expectedVersion`; regeneration creates a new report version and preserves the old version.

---

## File Map

- Modify `packages/contracts/src/interview.ts`: report state, chunk, chapter, timeline, generate/regenerate/export operations.
- Create `apps/api/migrations/20260815xxxxxx_f06_digital_interview_reports.sql`: reports, chunks, exports, timeline extensions.
- Create `apps/api/src/application/interview/workflow/digital-interview-report-nodes.ts`: evidence/stream/finalize/export graph nodes.
- Modify `apps/api/src/application/interview/workflow/digital-interview-graph.ts`: route `report_pending` through report nodes.
- Extend `apps/api/src/infrastructure/interview/workflow/pg-digital-interview-effects.ts`: chunk/finalize/version effects.
- Create `apps/api/src/application/interview/digital-interview-report-export.port.ts`: PDF/Word export boundary.
- Create `apps/api/src/infrastructure/interview/digital-interview-report-exporter.ts`: reuse artifact/file services.
- Modify controllers for generate/read/events/export.
- Create a dedicated web report view component and connect Markdown streaming, chapters, timeline, retry, and exports.

### Task 1: Define F06 report and export contracts

**Files:**
- Modify: `packages/contracts/src/interview.ts`
- Test: `packages/contracts/tests/digital-interview-contract.test.ts`

**Interfaces:**
- Consumes: F05 completed run/answer/source models.
- Produces: `DigitalInterviewReportView`, `DigitalInterviewReportChunk`, `DigitalInterviewReportChapter`, and operations `generateDigitalInterviewReport`, `getDigitalInterviewReport`, `regenerateDigitalInterviewReport`, `exportDigitalInterviewReport`.

- [ ] **Step 1: Write failing schema tests**

Assert report states `pending|generating|completed|failed`, monotonically increasing chunk sequence, chapters with heading/level/anchor, export formats `pdf|docx`, and export rejection for non-completed reports.

- [ ] **Step 2: Run the contract test**

Run: `pnpm --filter @repo/contracts test -- digital-interview-contract.test.ts`

Expected: FAIL because F06 operations are absent.

- [ ] **Step 3: Implement strict schemas and operations**

The report view returns metadata and chunk pagination/cursor, not a hidden speculative chapter list. Add errors `REPORT_NOT_READY` and `REPORT_EXPORT_FAILED`.

- [ ] **Step 4: Verify and commit**

Run: `pnpm --filter @repo/contracts test -- digital-interview-contract.test.ts && pnpm --filter @repo/contracts typecheck`

Expected: PASS.

```bash
git add packages/contracts
git commit -m "feat(interview): define streaming report contracts"
```

### Task 2: Add versioned report/chunk/export persistence

**Files:**
- Create: `apps/api/migrations/20260815xxxxxx_f06_digital_interview_reports.sql`
- Test: `apps/api/tests/itv/digital-interview-report-migration.test.ts`

**Interfaces:**
- Consumes: F05 revision/run/answer rows.
- Produces: `digital_interview_reports`, `digital_interview_report_chunks`, and `digital_interview_report_exports` with RLS and composite tenant FKs.

- [ ] **Step 1: Write a failing migration test**

Assert unique chunk `(org_id, report_id, sequence_no)`, one current report version per interview revision, immutable completed Markdown digest, export foreign keys, and cross-org rejection.

- [ ] **Step 2: Run the test**

Run: `pnpm --filter api test -- digital-interview-report-migration.test.ts`

Expected: FAIL because report tables do not exist.

- [ ] **Step 3: Implement migration and policies**

Store chunk text, sequence, cumulative digest, discovered headings JSON, source pointer IDs, generator provenance, failure code, and final Markdown digest. Binary export content belongs in the existing artifact/file store; this table keeps artifact IDs and status.

- [ ] **Step 4: Verify and commit**

Run: `pnpm --filter api test -- digital-interview-report-migration.test.ts && pnpm --filter api run migrate:check`

Expected: PASS.

```bash
git add apps/api/migrations apps/api/tests/itv/digital-interview-report-migration.test.ts
git commit -m "feat(interview): persist report stream versions"
```

### Task 3: Implement resumable report LangGraph nodes

**Files:**
- Create: `apps/api/src/application/interview/workflow/digital-interview-report-nodes.ts`
- Modify: `apps/api/src/application/interview/workflow/digital-interview-graph.ts`
- Modify: `apps/api/src/application/interview/workflow/digital-interview-effects.port.ts`
- Test: `apps/api/tests/itv/digital-interview-report-graph.test.ts`

**Interfaces:**
- Consumes: completed F05 answers/sources and report effects.
- Produces: nodes `prepare_report_evidence -> generate_markdown_stream -> finalize_report -> complete` plus safe `retry_report` and `regenerate_report` routing.

- [ ] **Step 1: Write failing graph tests**

Cover completed report, failure after chunk 2 followed by resume at chunk 3, source permission revocation before finalization, regeneration preserving v1 while v2 becomes current, and headings discovered incrementally.

- [ ] **Step 2: Run graph tests**

Run: `pnpm --filter api test -- digital-interview-report-graph.test.ts`

Expected: FAIL because report nodes are absent.

- [ ] **Step 3: Implement nodes and deterministic chunk identity**

Chunk `operationId` is `interviewId:generate_report:reportVersion:sequenceNo`. The generator receives evidence grouped by expert/question with source pointers. Finalization is a separate transaction that validates the cumulative digest and all source references.

- [ ] **Step 4: Verify and commit**

Run: `pnpm --filter api test -- digital-interview-report-graph.test.ts && pnpm --filter api typecheck`

Expected: PASS.

```bash
git add apps/api/src/application/interview/workflow apps/api/tests/itv/digital-interview-report-graph.test.ts
git commit -m "feat(interview): add resumable report graph"
```

### Task 4: Persist chunks and expose generation/read streams

**Files:**
- Modify: `apps/api/src/infrastructure/interview/workflow/pg-digital-interview-effects.ts`
- Modify: `apps/api/src/interface/controllers/digital-interview.controller.ts`
- Modify: `apps/api/src/interface/controllers/digital-interview-events.controller.ts`
- Test: `apps/api/tests/itv/digital-interview-report-controller.test.ts`

**Interfaces:**
- Consumes: F06 graph and tables.
- Produces: generate/regenerate/read endpoints and chunk/timeline SSE replay.

- [ ] **Step 1: Write failing integration tests**

Assert generate idempotency, refresh returns committed chunks, SSE reconnect after sequence 2 returns only later events/chunks, regenerate preserves old report, incomplete report is not exportable, and cross-org reads are concealed.

- [ ] **Step 2: Run tests**

Run: `pnpm --filter api test -- digital-interview-report-controller.test.ts`

Expected: FAIL with missing routes.

- [ ] **Step 3: Implement transactional chunk effects and controllers**

Insert chunk and timeline event in one transaction. Read projection concatenates committed chunks in sequence order and derives chapters by parsing committed Markdown headings.

- [ ] **Step 4: Verify and commit**

Run: `pnpm --filter api test -- digital-interview-report-controller.test.ts && pnpm --filter api typecheck`

Expected: PASS.

```bash
git add apps/api/src/infrastructure/interview/workflow apps/api/src/interface/controllers apps/api/tests/itv/digital-interview-report-controller.test.ts
git commit -m "feat(interview): stream persistent report chunks"
```

### Task 5: Implement PDF and Word export from finalized Markdown

**Files:**
- Create: `apps/api/src/application/interview/digital-interview-report-export.port.ts`
- Create: `apps/api/src/infrastructure/interview/digital-interview-report-exporter.ts`
- Modify: `apps/api/src/kernel.module.ts`
- Modify: `apps/api/src/interface/controllers/digital-interview.controller.ts`
- Test: `apps/api/tests/itv/digital-interview-report-export.test.ts`

**Interfaces:**
- Consumes: finalized Markdown version and existing artifact/file ports.
- Produces: `DigitalInterviewReportExporter.export({ orgId, actorId, reportId, format }) -> { artifactId, fileName, contentType }`.

- [ ] **Step 1: Write failing export tests**

Assert PDF starts with `%PDF`, DOCX is a valid ZIP package with `word/document.xml`, both include the same report title/sections, repeated request ID returns the same artifact, and pending reports return `REPORT_NOT_READY`.

- [ ] **Step 2: Run tests**

Run: `pnpm --filter api test -- digital-interview-report-export.test.ts`

Expected: FAIL because exporter is absent.

- [ ] **Step 3: Implement the port using existing document/artifact capabilities**

Do not introduce a second file store. Sanitize file names, preserve Chinese text, embed heading hierarchy, and record export artifact provenance back to the report version.

- [ ] **Step 4: Verify and commit**

Run: `pnpm --filter api test -- digital-interview-report-export.test.ts && pnpm --filter api typecheck`

Expected: PASS.

```bash
git add apps/api/src/application/interview/digital-interview-report-export.port.ts apps/api/src/infrastructure/interview/digital-interview-report-exporter.ts apps/api/src/kernel.module.ts apps/api/src/interface/controllers/digital-interview.controller.ts apps/api/tests/itv/digital-interview-report-export.test.ts
git commit -m "feat(interview): export finalized reports"
```

### Task 6: Build the streaming Markdown report UI

**Files:**
- Modify: `apps/web/lib/interview-api.ts`
- Create: `apps/web/components/itv/digital-interview-report-view.tsx`
- Modify: `apps/web/components/itv/digital-interview-workflow.tsx`
- Create: `apps/web/app/itv/[interviewId]/report/page.tsx`
- Test: `apps/web/tests/ui/interview-report-view.test.tsx`

**Interfaces:**
- Consumes: F06 report/read/events/export operations.
- Produces: report body, discovered chapter navigation, right timeline, resume/retry/regenerate, PDF/Word export.

- [ ] **Step 1: Write failing UI tests**

Assert initial generation has no invented chapters, committed Markdown renders as headings/paragraphs rather than raw `#` text, new headings populate chapter navigation, the right timeline survives reconnect, completed report enables PDF/Word, and both workflow/header return buttons navigate to `/itv?tab=history`.

- [ ] **Step 2: Run UI tests**

Run: `pnpm --filter web test -- interview-report-view.test.tsx`

Expected: FAIL because the current report is a local `<pre>` and the standalone report route is missing.

- [ ] **Step 3: Implement the report page and stream reducer**

Initialize from GET, then apply only events/chunks with a higher cursor/sequence. Render sanitized Markdown with existing project components. Keep the timeline at right on desktop and below the body on narrow screens. Chapter links use stable heading anchors discovered from committed content.

- [ ] **Step 4: Add export and regeneration controls**

Disable exports until completed. Regeneration requires confirmation, starts a new server version, clears only the current-view stream, and keeps the prior version accessible through report history.

- [ ] **Step 5: Run F06 verification**

Run: `pnpm --filter web test -- interview-report-view.test.tsx && pnpm --filter web typecheck && pnpm --filter web run lint:design && pnpm --filter api test -- digital-interview-report && pnpm --filter api run migrate:check`

Expected: PASS.

- [ ] **Step 6: Commit and deliver one F06 PR**

```bash
git add apps/web
git commit -m "feat(interview): render and export streaming reports"
```

Run `pnpm harness verify --sprint 04/01` and `pnpm harness doctor --phase 04`, record screenshots and command output, then open one PR with `Closes #<F06 issue>`.
