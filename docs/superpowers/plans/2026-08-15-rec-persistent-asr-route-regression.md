# `/rec` Persistent ASR Route Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan.

**Goal:** Restore `/rec` to the existing personal realtime-ASR route so final text, manual edits, and later captures persist to the user's transcription record.

**Architecture:** Keep Chat on `/chat/asr-draft`, but wire the recording workspace back to `openBoardxRealtimeAsr`. The existing personal gateway remains the persistence authority: it appends each final segment before publishing it, and the browser reloads the persisted detail after `completed`. Existing stale-capture recovery and deletion behavior remain intact.

**Tech Stack:** Next.js, React, TypeScript, Vitest, existing BoardX HTTP/WebSocket contracts, AudioWorklet.

## Global Constraints

- Issue: #1268; one regression fix, one branch, one PR.
- No new package, database migration, ASR environment variable, or external contract.
- Do not change Chat draft transcription behavior.
- Keep final-segment deduplication, idempotent cleanup, and stale-capture recovery.
- Use `apply_patch` for source edits and preserve unrelated worktree changes.

---

### Task 1: Make the UI regression tests describe persistent behavior

**Files:**
- Modify: `apps/web/tests/ui/realtime-transcription-history.test.tsx`
- Modify if copy assertions require it: `apps/web/tests/ui/realtime-transcription-workspace.test.tsx`

- [ ] Replace the test that expects `openAsrDraftStream` with one that expects `openBoardxRealtimeAsr` for the selected personal transcription.
- [ ] Drive duplicate and distinct `final` events through the captured handlers and assert each `segmentId` is appended only once.
- [ ] Change the stop test to assert that the personal stream is stopped, `completed` is awaited, and persisted detail is read again.
- [ ] Change the edit test to assert `updatePersonalTranscriptionContent` receives the transcription id, edited body, and session token.
- [ ] Assert the temporary-page-only warning is absent.
- [ ] Run the focused UI tests and confirm they fail for the current draft-route implementation:
  `pnpm --filter web exec vitest run tests/ui/realtime-transcription-history.test.tsx tests/ui/realtime-transcription-workspace.test.tsx`

### Task 2: Restore the personal persistent client in `/rec`

**Files:**
- Modify: `apps/web/components/rec/transcription-history.tsx`
- Modify: `apps/web/components/rec/realtime-transcription-workspace.tsx`

- [ ] Import and use `openBoardxRealtimeAsr`; remove `/rec`'s dependency on `openAsrDraftStream`.
- [ ] Restore a per-capture `Set<string>` for final `segmentId` deduplication.
- [ ] Keep interim text separate from the saved body and append only unique final text to the visible body.
- [ ] On stop, wait for the personal client to receive `completed`, then fetch the personal transcription detail and replace local text with persisted content.
- [ ] Restore manual edit persistence through `updatePersonalTranscriptionContent`.
- [ ] Remove the temporary/non-persistent warning and describe persisted final text accurately.
- [ ] Preserve legacy HTTP stop for a `recording` detail with no local stream handle.
- [ ] Run the focused UI tests and confirm they pass.

### Task 3: Verify client and server persistence invariants

**Files:**
- Test: `apps/web/tests/lib/boardx-realtime-asr-client.test.ts`
- Test: `apps/web/tests/e2e/personal-realtime-transcription-smoke.test.ts`
- Test: `apps/api/tests/recording/personal-realtime-asr-provider-wiring.test.ts`
- Test: `apps/api/tests/recording/configured-realtime-asr-provider.test.ts`
- Test: `apps/api/tests/recording/personal-realtime-asr-gateway.test.ts`
- Test: `apps/api/tests/recording/personal-realtime-asr-usage.test.ts`
- Test: `apps/api/tests/recording/provider-final-persist-before-push.test.ts`

- [ ] Run the web client/smoke tests:
  `pnpm --filter web exec vitest run tests/lib/boardx-realtime-asr-client.test.ts tests/e2e/personal-realtime-transcription-smoke.test.ts`
- [ ] Run the API gateway/provider tests:
  `pnpm --filter api exec vitest run tests/recording/personal-realtime-asr-provider-wiring.test.ts tests/recording/configured-realtime-asr-provider.test.ts tests/recording/personal-realtime-asr-gateway.test.ts tests/recording/personal-realtime-asr-usage.test.ts tests/recording/provider-final-persist-before-push.test.ts`
- [ ] Run web typecheck: `pnpm --filter web run typecheck`.
- [ ] Run the F173 harness regression verification: `pnpm harness verify --sprint 01/05 --feature F173`.

### Task 4: Record evidence and publish the regression fix

**Files:**
- Modify only the harness evidence/progress files produced by the authorized verification workflow.

- [ ] Post the exact failing root cause, implementation SHA, and verification results to issue #1268.
- [ ] Commit only files in this regression's scope.
- [ ] Push `worker/coord-voice-01-f173-persistent-route`.
- [ ] Open a PR to `main` containing `Closes #1268`.
- [ ] Do not claim completion until CI/harness evidence is green and the implementation is merged to `main`.
