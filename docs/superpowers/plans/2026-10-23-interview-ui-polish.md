# Interview UI polish Implementation Plan

> Execute inline with superpowers:executing-plans; final independent whole-branch review.

**Goal:** Resolve the four human-confirmed interview UI problems in #5890.
**Architecture:** Local presentation fixes; canonical source remains authoritative. No module-global actor data cache. Preserve a shared workbench across stage navigation where possible, and represent unknown completion explicitly.
**Tech Stack:** Next.js, React, Tailwind, Vitest, Chromium.
**Spec:** docs/superpowers/specs/2026-10-23-interview-ui-polish-design.md (human approved in chat).

## Global Constraints
Reuse current worktree. One issue/PR. No API, model, permission, source-content or passing changes. No self merge.

## Review Focus
Delayed source loading; failed/retried source; new revisions invalidating later steps; expert switching and refreshed content; mobile keyboard/focus and long answers.

## Tasks
- [ ] Intake: use Textarea in a unified local editor frame, visible label and hint; verify existing intake tests and real focus/typing at three widths.
- [ ] Outline: add failing assertions in interview-markdown-editing.test.tsx for one generation status, no misleading empty state, stable disabled button and old-content preservation. Run red, change interview-outline-step.tsx/header animation, run green.
- [ ] Runs: add failing default-collapse, manual-toggle and selected-expert tests in interview-source-runs.test.tsx. Change interview-runs-step.tsx; preserve complete source rendering and attribution when open. Update existing tests to explicitly expand before inspecting content, run suite.
- [ ] Navigation: add failing delayed-load/retry assertions in interview-markdown-workbench.test.tsx. Represent unknown completion and retain the mounted workbench across stage selection; never infer completion from route order. Test canonical revision transitions and identity change.
- [ ] Validate: affected UI suite, web typecheck/design lint, local Chromium at 375/768/1280 with controlled HTTP/session fixtures and delay injection. Record exact boundaries and screenshots in docs/evidence/interview-ui-5890.
- [ ] Review final commit, resolve actionable findings, push and automatically create PR with Closes #5890. Follow authoritative pr-queue to green. Never merge.

## Execution ledger
- Human confirmed design and default collapsed answers. Branch codex/interview-ui-polish-1023 starts at fetched origin/main. Worktree initially clean except this task's design document.
- Coordination tick blocked by missing COORD_GATEWAY_URL; no lease acquired or renewed.
