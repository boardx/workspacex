# Isolation Fixture Admission Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep production stack admission fail-safe while making wrapper lifecycle tests independent of host load.

**Architecture:** Export the existing wrapper lifecycle with a single admission dependency. Keep the executable entry on real admission and introduce a test-only executable entry that supplies an immediate slot.

**Tech Stack:** TypeScript, Node child processes, Vitest.

## Global Constraints

- Do not change stack admission limits or watchdog durations.
- Do not expose a production environment-variable bypass.
- Keep real subprocess, signal, exit-code, and cleanup assertions.

---

### Task 1: Add the deterministic lifecycle contract

**Files:**
- Modify: `.harness/scripts/fullstack-smoke.test.ts`
- Create: `.harness/scripts/fixtures/with-test-isolation-fixture.ts`
- Modify: `.harness/scripts/with-test-isolation.ts`

**Interfaces:**
- Consumes: `acquireStackSlot(options): Promise<StackSlot>`
- Produces: `runWithTestIsolation(argv, runtime): Promise<number>`

- [ ] Add assertions requiring a fixture path, forbidding package-script references, and requiring the production entry to retain real admission.
- [ ] Run the focused test and confirm it fails because the fixture/export do not exist.
- [ ] Extract the lifecycle function and add the test-only fixture with immediate admission.
- [ ] Point lifecycle subprocess tests to the fixture.
- [ ] Run the focused test and confirm all assertions pass.
- [ ] Run `pnpm -w run verify:base` and confirm the complete base gate passes.
- [ ] Commit and open a PR that closes #1075.

