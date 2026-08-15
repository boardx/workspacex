# Task 7 report — persistent Digital Interview setup UI

## Scope

- Replaced the non-Mock setup placeholder with a GET-hydrated `DigitalInterviewWorkflowView`.
- Added shared-contract API helpers for the three explicit confirmations and Skill append/apply/reject endpoints.
- Kept Mock interview IDs on their existing local demonstration workflow; live interview IDs never use localStorage as a recovery source.
- Added per-step live buffers for topic, experts, and questions. Input changes do not write; successful explicit confirmations replace both the recovered view and local buffers.
- Added dirty-change confirmation for workflow steps and the return action, browser `beforeunload` protection, and discard/continue behavior.
- Skill messages and the complete proposal lifecycle render from the returned workflow view. Sending, applying, and rejecting persist immediately; apply patches only the matching local draft and leaves it dirty until confirmation.
- Expanded mocked-HTTP UI coverage for hydration, no-autosave, expected version/request IDs, retry ID stability, dirty navigation, unload protection, local-only application, rejection, and stale-proposal non-application.

## Verification

```text
pnpm --filter web exec vitest run tests/ui/interview-setup-workflow.test.tsx tests/ui/interview-skill-assistant.test.tsx --pool=forks --maxWorkers=1 --minWorkers=1
```

Passed: 2 files, 15 tests.

```text
pnpm --filter web typecheck
pnpm --filter web run lint:design
git diff --check
```

All completed with exit code 0. `lint:design` reported `全部通过（扫描 app components lib）`.

## Risks / follow-up

- This task deliberately uses mocked HTTP in UI tests. The API worker must return the full contract workflow view (including complete Skill message/proposal history) on every successful write for the UI to preserve state across refresh.
- Live expert labels fall back to the returned expert ID when it is not present in the current Mock persona display catalog; the persisted selection itself is unaffected.
