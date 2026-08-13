# F169 Guided Research Human Checkpoints Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist and expose separate brief, research-direction, and report-outline confirmation checkpoints without regeneration overwriting the latest human-confirmed version.

**Architecture:** Extend the shared research contract with versioned direction and outline snapshots. Store snapshots inside the existing tenant-scoped guided session aggregate, mutate them through repository transactions, and generate candidates through an injected application port. The web flow reads and writes only those BoardX APIs; mock data no longer drives the direction or outline screens for persisted sessions.

**Tech Stack:** TypeScript, Zod, NestJS, PostgreSQL/RLS, React, Vitest, Testing Library.

## Global Constraints

- F169 is the only feature in scope; Issue #1110 and sprint 01/05 are its audit chain.
- Candidate generation never changes `confirmedVersion`; confirmation creates a new immutable version.
- Empty topic/goal, zero enabled directions, and zero enabled non-empty outline sections are rejected on both contract and server paths.
- Controllers call injected ports and never connect directly to the external deep-research service.
- Existing F168 owner/collaborator visibility and indistinguishable 404 behavior remain unchanged.

---

### Task 1: Shared checkpoint contract

**Files:**
- Modify: `packages/contracts/src/research.ts`
- Modify: `packages/contracts/tests/guided-research-session-contract.test.ts`

**Interfaces:**
- Produces: `GuidedResearchDirection`, `GuidedResearchOutlineSection`, version snapshots, and four generate/confirm operations.

- [ ] Write contract tests proving candidate and confirmed versions are distinct and empty enabled content is rejected.
- [ ] Run `pnpm --filter @repo/contracts exec vitest run tests/guided-research-session-contract.test.ts` and observe the missing-schema failure.
- [ ] Add the minimal schemas and operation definitions.
- [ ] Re-run the contract test and keep it green.

### Task 2: Tenant-safe persistence and generation port

**Files:**
- Create: `apps/api/migrations/20260813100000_f169_guided_research_checkpoints.sql`
- Modify: `apps/api/src/application/research/guided-session-ports.ts`
- Create: `apps/api/src/domain/research/guided-research-checkpoint-generator.ts`
- Modify: `apps/api/src/infrastructure/research/pg-guided-research-session-repository.ts`
- Modify: `apps/api/src/interface/controllers/guided-research.controller.ts`
- Modify: `apps/api/src/kernel.module.ts`
- Create: `apps/api/tests/research/guided-session-human-checkpoints.test.ts`

**Interfaces:**
- Produces: repository methods `generateDirections`, `confirmDirections`, `generateOutline`, and `confirmOutline`.
- Consumes: injected `GuidedResearchCheckpointGenerator`; the controller never imports its implementation.

- [ ] Write API tests for generate/edit/confirm/regenerate, validation gates, recovery, and tenant invisibility.
- [ ] Run the isolated API test and observe missing-route failures.
- [ ] Add JSONB version columns and transactional repository mutations with row locks.
- [ ] Add a deterministic generator behind the injected port, wire it in the kernel, and add controller routes.
- [ ] Re-run the isolated API test and keep it green.

### Task 3: Live direction and outline screens

**Files:**
- Modify: `apps/web/lib/guided-research-api.ts`
- Modify: `apps/web/components/research-studio/guided-research-flow.tsx`
- Create: `apps/web/tests/ui/guided-research-checkpoints-live.test.tsx`

**Interfaces:**
- Consumes: the four shared checkpoint operations and `GuidedResearchSession` snapshots.
- Produces: editable direction/outline screens whose buttons await server confirmation before navigation.

- [ ] Write UI tests for restore, edit/add/delete/toggle, disabled validation gates, candidate regeneration, and confirmed-version preservation.
- [ ] Run the UI test and observe missing API-call failures.
- [ ] Add API helpers and replace mock-driven checkpoint screens with session-backed state.
- [ ] Re-run the UI test and web typecheck.

### Task 4: Audit evidence and delivery

**Files:**
- Modify: `phases/phase-01-run-a-project/sprints/sprint-05/progress.md`
- Modify: `phases/phase-01-run-a-project/sprints/sprint-05/session-handoff.md`
- Generated: `phases/phase-01-run-a-project/sprints/sprint-05/evidence/F169.verify.log`

- [ ] Run all four F169 verification commands.
- [ ] Run `pnpm harness verify --sprint 01/05 --feature F169` and `pnpm harness doctor --phase 01`.
- [ ] Record exact results, commit, push, open a PR with `Closes #1110`, and transfer the all-green PR to `coord-main`.
