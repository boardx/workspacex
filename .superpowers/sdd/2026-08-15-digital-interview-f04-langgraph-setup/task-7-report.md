# Task 7 report — persistent Digital Interview setup UI

## Scope

- Replaced the non-Mock setup placeholder with a GET-hydrated `DigitalInterviewWorkflowView`.
- Added shared-contract API helpers for the three explicit confirmations and Skill append/apply/reject endpoints.
- Kept Mock interview IDs on their existing local demonstration workflow; live interview IDs never use localStorage as a recovery source.
- Added per-step live buffers for topic, experts, and questions. Input changes do not write; successful explicit confirmations replace both the recovered view and local buffers.
- Added dirty-change confirmation for workflow steps and the return action, browser `beforeunload` protection, and discard/continue behavior.
- Skill messages and the complete proposal lifecycle render from the returned workflow view. Sending, applying, and rejecting persist immediately; apply patches only the matching local draft and leaves it dirty until confirmation.
- Expanded mocked-HTTP UI coverage for hydration, no-autosave, expected version/request IDs, retry ID stability, dirty navigation, unload protection, local-only application, rejection, and stale-proposal non-application.
- Review fix: the signed home-page create modal now posts the strict `name`/`tags`/`scope`/`requestId` input and opens setup with the returned live interview ID. Failed identical submissions reuse the request ID and retain user input.
- Review fix: production history and expert tabs no longer inject local Mock rows. The expert tab reads the formal catalog, and Mock drafts/personas are available only through the explicit `/itv?preview=mock` preview path.
- Review fix: live setup renders expert candidates and default questions returned by the workflow recovery view; it no longer manufactures a selected expert from the persona fixture. Skill sends include the contract-backed current draft context.

## Verification

```text
pnpm --filter web exec vitest run tests/ui/interview-studio-home.test.tsx tests/ui/interview-setup-workflow.test.tsx tests/ui/interview-skill-assistant.test.tsx --pool=forks --maxWorkers=1 --minWorkers=1 --reporter=verbose
```

Passed: 3 files, 31 tests.

```text
pnpm --filter web typecheck
pnpm --filter web run lint:design
git diff --check
```

All completed with exit code 0. `lint:design` reported `全部通过（扫描 app components lib）`.

## Risks / follow-up

- This task deliberately uses mocked HTTP in UI tests. The API worker must return the full contract workflow view (including complete Skill message/proposal history) on every successful write for the UI to preserve state across refresh.
- Live expert labels come from the catalog candidates returned in the workflow view. A raw ID is displayed only when recovery references a candidate omitted by the server, preserving access to the persisted selection while making the projection inconsistency visible.
