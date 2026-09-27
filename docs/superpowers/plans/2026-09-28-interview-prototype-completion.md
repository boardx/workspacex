# Interview Prototype Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Resume existing work; do not create another worktree.

**Goal:** Finish the approved interview workbench without independent JSON research bodies.

**Architecture:** Canonical immutable Markdown documents carry research content. Metadata carries identity, authorization, version, task state and evidence. Read-only projections drive six routes and the history list.

**Spec:** `docs/superpowers/specs/2026-09-27-interview-markdown-source-design.md`; latest eight grayscale user-provided prototype screenshots.

**Issue:** #4483. **Branch:** `codex/interview-prototype-completion`, based on main `4b297f1be`.

## Global Constraints

- Reuse interview-seven-step-rebuild worktree; no merge, auto-merge or CI bypass.
- Preserve all old revisions, actor/tenant visibility, evidence boundaries and user edits.
- Workspace menu on list only; selected interview has shared six-step header and separate routes.
- Every model input and saved research body is Markdown; parsed UI is not a second source.
- No claim of visual fidelity or full completion without real browser evidence.

## Review Focus

- An old running response must not overwrite a newer pause/completion.
- A retry must preserve saved answers and not re-run completed expert tasks.
- Confirmed documents need a new-revision action, not an unsaveable editor.
- Printed/exported report must retain trusted simulation and approval disclosure.
- Unsaved virtual experts cannot obtain preferences by inventing a catalogue agent.

## Tasks and Progress

- [x] Add leased Markdown execution, failed-partial preservation, immutable answer versions and report readiness gating.
- [x] Derive history state/expert counts/sourceStep from canonical source without JSON body writes.
- [x] Persist account-scoped catalogue avatars and interview-scoped saved virtual avatars; fixed SVG keys only.
- [x] Connect six named routes to source workbench, add standalone creation and dirty navigation protection.
- [x] Preserve source links in analysis and add expert-specific summary tabs.
- [x] Repair PDF evidence disclosure in the printable document.
- [x] Add source revision branching and wire immutable-document edit recovery.
- [x] Integrate canonical-version report review/share without inheriting obsolete legacy approval. Approval remains fail-closed without trusted evidence qualification.
- [x] Complete attachment/voice capability gaps using existing authorized services; real microphone/browser acceptance remains below.
- [ ] Browser screenshot/interactions across list, six steps and virtual-expert modal, including refresh and failure recovery.
- [ ] Independent final review, fresh verification, commit/push and PR; follow current-head CI and review to green.

## Verified Checkpoint (not final completion)

- `./init.sh`: exit 0, fast bootstrap/health checks.
- `pnpm --filter web typecheck`: exit 0 after frozen-lockfile offline install restored already-declared qrcode dependency. No dependency manifest change.
- Web next lint: exit 0 after stable hook dependencies.
- 21 interview UI files / 123 tests: pass.
- 72 interview API files / 520 tests: pass via real isolated Postgres wrapper, 105 seconds; stack cleaned.
- Independent review identified creation failure recovery and report-review CAS recovery gaps; repaired with regression assertions and re-reviewed without further blockers.
- Final interview API: 74 files / 532 tests passed via isolation wrapper, resources cleaned. Final scoped web UI/client: 17 files / 121 tests passed. Web/API typecheck and web lint exit 0.
- Original object-store interface lacks delete: a conflict after upload can leave an unreferenced blob; database attachment metadata and Markdown draft remain atomic.
- Earlier whole-web test run: 640 files pass, 6 fail; whiteboard six assertions, survey missing installed qrcode, and intermediate avatar cases. Current targeted avatar tests are green. Whole-web suite is not claimed green.
- Native browser connection timed out repeatedly. User asked asynchronously for permission to use local Chromium; no response recorded yet.

## Working-state Protection

Three pre-existing `docs/evidence/user-feedback-3600/invite-*.png` changes are unrelated test-generated files: preserve, do not stage. Implementation was pushed as `dc12d9f57` in draft PR #4486; browser acceptance remains pending. No feature status manually marked passing.

## Follow-up audit

- Found queued expert tasks incorrectly labeled active: added a failing regression, fixed label to 等待访谈, 9 related tests pass.
- Current-head CI exposed replay failures in three new RLS policies. Added replay-safe policy recreation; real `migrate:check` applied 322 migrations, force replayed every file, and verified identical schema and populated data (exit 0, isolated stack cleaned).
- Navigation lint did not recognize a conditional `router.push` argument. Expanded it into explicit scoped/default branches without changing behavior; navigation reachability passes.
- Browser smoke still used legacy JSON-route fixtures for two canonical-route cases. Updating those fixtures without removing avatar refresh, timeline, responsive or legacy Skill coverage.
- Native browser reaches the local app but is redirected to login without a running authenticated API stack. No eight-screen visual completion claim has been made. Requested explicit permission for repository Chromium/Playwright acceptance as an alternative.
- CI at `bf0c49508`: migration/runtime and backend-required passed. UI-wiring found the new page importing a legacy mock-bearing module and stale shell classification. Extracted the live creation adapter (single implementation, legacy re-export), mechanically regenerated wiring manifest without increasing mock allowances; wiring and four creation tests pass. Fullstack-smoke timed out before running tests during server startup; logs stop after compose health, so no assertion failure or successful visual acceptance is inferred. No timeout limit changed.
