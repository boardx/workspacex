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
- Initial read-only review: no Critical/Important findings. The resize-without-text-change boundary was subsequently reported in PR #5017 and is addressed below.

Screenshots from this run: `desktop-editing.png`, `mobile-editing.png`.

Handoff: local verification passed; PR CI must be checked independently. No merge or deployment performed.

## PR #5017 resize review correction — 2026-10-02

Merged latest main `d19128e17` into the existing branch before this correction; no new worktree.

- Before the fix, the real browser regression failed with `scrollHeight - clientHeight = 166` after narrowing the viewport without changing the title.
- Added a width-only `ResizeObserver` while the multiline editor is open; height-only notifications are ignored and the observer disconnects on cleanup. No source/save changes.
- After the fix, the same real API/Postgres/browser command passed (1 passed, 8.4m): long title at 1586 → 768 → 375 → 1586 px, no clipped content at narrow widths, and height shrinks again on returning to desktop.
- Fresh survey suite: 37 files / 340 tests passed. TypeScript and changed-file ESLint exited 0. Node 22.23.2; isolated environment cleaned in 2 seconds.
- Logs: `/private/tmp/survey-resize-red.log`, `/private/tmp/survey-resize-green.log`, `/private/tmp/survey-resize-unit.log`, `/private/tmp/survey-resize-types.log` (local run artifacts).

Latest PR CI remains a separate gate; this evidence does not claim merge or deployment.
