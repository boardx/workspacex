# AIDT module isolation evidence

Scope: optional AIDT module and compatibility with existing WorkspaceX behavior. Full classroom P0 is still tracked in `backlog.md`. No deployment, permission change, migration or new service contract is included.

Base: `origin/develop` at `86c1092798575d4348d658a56063a8f32b478bb8`. Branch: `worker/aidt-module-latest`. The previous UI and isolation worktrees were preserved. Code was applied to the current develop snapshot without merging or publishing a shared branch.

## Ownership and results

| Owner | Work | Local lane |
|---|---|---|
| Agent 1 / aidt_entry_isolation | default-off entry, routes and generic creation adapter | 82 passing |
| Agent 2 / aidt_chat_isolation | native Chat host, scope and cancellation | 23 passing |
| Agent 3 / aidt_state_isolation | actor/project state, stale callbacks, A→B→A lifecycle | 24 passing; genuine red/green evidence included |
| Agent 4 / aidt_resource_isolation | resource loading, permission transitions, Board return | 22 passing |
| Agent 5 / aidt_backend_isolation | explicit skill bootstrap opt-in | 20 passing, no database |
| Agent 6 / aidt_compatibility_tests | ordinary feature compatibility and dependency gate | 42 passing |
| Primary agent | module migration, latest-develop integration, cross-check and delivery | integrated results below |

Lane counts overlap; do not add them. The final two disjoint frontend runs contain **267 tests in 36 files** (203 + 64). The final API run contains **20 tests in 3 files**, using no PostgreSQL. Both full application typechecks and lint commands passed; explicit module ESLint also passed. The generic native Chat empty-state file remains byte-identical to develop (`5c4ed1043bcba04aa30b4b4dc8f55c8771d47a80`).

## Reproduce

From repository root with its declared dependencies installed:

```bash
WORKSPACEX_WEB_TEST_MAX_WORKERS=2 pnpm --filter web test tests/ui/aidt tests/ui/project-aidt tests/ui/home-aidt tests/aidt tests/live-aidt tests/ui/team-text-conversation.test.tsx tests/ui/chat-task-workbench-empty-state.test.tsx tests/ui/create-project-dialog.test.tsx tests/ui/projects-screen-live.test.tsx tests/ui/project-conversations.test.tsx tests/ui/project-breadcrumb.test.tsx tests/ui/workflow-nav.test.tsx tests/ui/copilotkit-v2-composer-recording-send-gate.test.tsx tests/ui/copilotkit-v2-composer-accessible-name.test.tsx tests/ui/composer-draft-prefill.test.tsx
WORKSPACEX_WEB_TEST_MAX_WORKERS=2 pnpm --filter web test tests/ui/browser-title.test.tsx tests/ui/chat-handoff-panel.test.tsx tests/ui/copilotkit-v2-shell-thread-switch.test.tsx tests/ui/project-collaborators-panel.test.tsx tests/ui/workbench-composer-draft.test.tsx tests/ui/copilotkit-v2-composer-recording-scroll.test.tsx
pnpm --filter @repo/api exec vitest run --config vitest.aidt-isolation.config.ts
pnpm --filter web typecheck
pnpm --filter @repo/api typecheck
pnpm --filter web lint
pnpm --filter @repo/api lint
pnpm --filter web exec eslint features/aidt --ext .ts,.tsx --max-warnings 0
```

Check `latest-*.txt` for actual command output and test file names. Existing installed external dependencies were reused, with workspace package symlinks redirected to this latest checkout; no lockfile or dependency versions changed. A complete fresh dependency install was not run.

## Enable and boundaries

Build the web app with `NEXT_PUBLIC_ENABLE_AIDT=1` and restart the API with `ENABLE_AIDT_MODULE=1` in an isolated development environment. The web switch is build-time. Both default off; they grant no permissions. Routes are `/aidt` and `/aidt/:projectId`. These paths require a running configured WorkspaceX instance and login; they are not an externally hosted demo link.

Ordinary projects retain their native route, including historical tagged projects when the module is off. Disabling backend bootstrap does not delete installed skill rows. AIDT source lives in `apps/web/features/aidt`; global member communication components stay outside the teaching module. Generic Chat compositor/messages are reused.

Local stage drafts are page-local, not durable shared group state. Member text transport, new shared structured saves, real model/ASR integration acceptance and the 30-person classroom pilot are outstanding. The opt-in native E2E is default-skipped and was not run against a real backend this turn. Unit tests do not establish microphone consent, actual recording, model quality, two-member message delivery or production readiness. Voice rooms remain deferred.

The repository coordination gateway is unconfigured; no lease or CI result is claimed. GitHub external publication was previously rejected and was not retried. No PR or remotely running preview is claimed by this evidence bundle.
