# A2 — historical return reflection into native TeachingContext

Scope: existing approved AIDT module, read-only host wiring. No backend/service/permission contract, Skill package, design signoff or production deployment changed. Parent `project-aidt.tsx` is deliberately untouched; the integrating root passes its existing `returnRevision` value as the optional `ProjectAidtChat` prop.

## Actual gap and change

`returnRevision` survived navigation, but current/earlier-stage-only `sharedContextRefs` prevented an earlier step's Agent from seeing the selected sixth-stage learning record. A separate loader now calls the existing append-only Stage history endpoint exactly once with `stageId=6`, `beforeRevision=revision+1`, `limit=1`. It never substitutes the latest stage or walks an unbounded history.

The response must satisfy the existing Stage schema, exact project, sixth stage, exact revision, existing student reflection-confirmation predicate and selected return destination equal to current step 1–5. Missing, unauthorized, invalid, unconfirmed or mismatching records yield no items. Abort or module-disable invalidates even a transport that ignores cancellation. Historical age itself does not revoke an immutable revision: old revisions are intentional here; expired component/request scopes cannot supply context.

Only a bounded field whitelist is projected: original verification question, beliefs before/after testing, return reason, next action, prototype reference, change status, student-recorded material basis and unresolved questions. The first five fields receive budget first. Each value is at most 1,200 UTF-16 units and all values together at most 8,000; truncation avoids splitting surrogate pairs and is visible. Reports, ideas, arbitrary fields, source-reference graphs and bearer tokens are absent from the DTO. The UI shows the exact same field projection supplied to `useAgentContext` as plain text.

The host's independent lifecycle scope includes organization, user, token, project, step, thread, selected revision and retry generation. Scope changes remove previous ready context during render and cancel earlier reads; generation checks reject late/ABA results. Deselecting the return reference immediately removes it. There is no cross-scope cache. A failed read offers “重新读取返工反思”; native Chat and its unsent composer remain available.

The existing `CopilotKitV2Shell`, providers, navigation and TeachingContext are retained. A small details/status panel follows existing saved-material panels; there is no new chat engine or composer. Context explicitly marks reflection as untrusted student-authored material, editor-confirmed and evidence-not-verified. Student-authored instructions cannot gain system authority through this surface; student confirmation does not establish group agreement, real evidence or test success.

## Reproduction and evidence

Working directory for the test command below: `apps/web`. Runtime: Node 22 and pnpm 9.15 supplied by root. Root's unified `./init.sh` exited 0 before final validation; this worker did not reinstall dependencies or run a separate full build/typecheck.

```sh
PATH=/tmp/aidt-node/node_modules/node/bin:/tmp/aidt-tools/node_modules/.bin:$PATH WORKSPACEX_WEB_TEST_MAX_WORKERS=1 node_modules/.bin/vitest run --config vitest.config.ts tests/aidt-chat-return-context.test.ts tests/ui/project-aidt-chat.test.tsx tests/aidt-module-boundary.test.ts tests/ui/aidt-module-compatibility.test.tsx tests/aidt-chat-shared-context.test.ts tests/aidt-stage-history-client.test.ts
PATH=/tmp/aidt-node/node_modules/node/bin:/tmp/aidt-tools/node_modules/.bin:$PATH node_modules/.bin/next lint --file features/aidt/components/project-aidt-chat.tsx --file features/aidt/lib/aidt-chat-return-context.ts
```

- `red-loader.log`: initial loader module absent (test collection fails).
- `red-host.log`: existing host ignores the explicit historical selection; 10 new targeted checks fail and 23 existing checks pass.
- `green-targeted.log`: 6 files / 69 tests pass after the change, including 7 loader checks and 34 host checks.
- `lint.log`: targeted production-file ESLint passes without warnings.
- `plan.md`: colored execution plan; validation status reflects these local checks only.

These are mocked transport/host unit and integration checks. They do not prove a real provider/model, deployed environment, real browser, PostgreSQL authorization or classroom acceptance. Root owns parent wiring, integrated typecheck/build and browser inspection. No real model configuration was added; `cn.local.env` is unavailable in this cloud environment.

## Integration acceptance

Save a student-confirmed sixth-step reflection whose return destination is step 2, retain its immutable revision, then return to step 2 Chat. Expand “历史返工反思”; the exact bounded fields should appear while the canonical composer remains. A foreign project, wrong revision or return step, unconfirmed record, unauthorized response or cancellation must contribute no student text. Simulate a read failure and use retry; the existing unsent native input must survive. Model facilitation quality and student's retained direction choice require separate real-model/human review.
