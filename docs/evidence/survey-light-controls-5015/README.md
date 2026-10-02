# Survey designer compact controls — #5015

Scope: light controls inside the designer, non-wrapping question numbers beside titles, and single-row inline editors that grow for longer content. Publishing remains the black primary header action. No API/schema/publishing behavior changes.

Based on main `1419644a1`; existing session worktree reused, branch `codex/survey-light-controls`.

Verification on 2026-10-02:

- Single-row regression failed before the implementation (`survey-light-red.log`).
- `pnpm --filter web exec vitest run survey`: 37 files, 340 tests passed.
- `pnpm --filter web exec tsc --noEmit`: exit 0.
- Changed production, unit and browser files ESLint: exit 0.
- Real isolated API/Postgres/browser: `pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter web exec playwright test --config playwright.fullstack-smoke.config.ts --project=seeded e2e/survey-complete-flow.spec.ts --grep '题目原位编辑后' --no-deps --workers=1`: 1 passed. Includes actual computed colors, same-row bounds at 1586/768/375 widths, rows=1 and height <44px, source PUT and reload persistence. No request mocking added.
- Runtime: Node 22.23.2. Isolation stack `wsx-da9c8fcfad487278123a` automatically cleaned in 2 seconds.
- Read-only review: no Critical/Important findings. Existing resize-without-text-change autosizing boundary remains outside this small change.

Screenshots from this run: `desktop-editing.png`, `mobile-editing.png`.

Handoff: local verification passed; PR CI must be checked independently. No merge or deployment performed.
