# Platform Model Testbench Internationalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox syntax.

**Goal:** Localize the complete real platform model testbench while preserving its existing request, safety and financial behavior.
**Architecture:** One typed page namespace and render-time semantic failures reuse the existing I18nProvider. Tests separate configured mocked UI coverage from real unavailable-adapter historical recovery/candidate/permission acceptance, because the default API has no trusted model-test adapter.
**Tech Stack:** React/TypeScript, Vitest, canonical Playwright/Nest/PostgreSQL fixtures.
**Spec:** docs/design/platform-model-tests-i18n/spec.md.

## Global constraints

- Issue6246; same worktree, branchworker/i18n-platform-model-tests-6246, fresh fetched origin/develop ef49474134137e7d07cef97577d4799fbd9c0eb8. Accepted6240 merge dd394 is an actual ancestor; its published78ae is preserved. Never create another worktree.
- Only display i18n/aria and necessary label layout. Preserve every existing behavioral test statement and all production SDK/contracts/API/provider/money helpers. Raw data/prompt/results/IDs/enums/currency/amount precision, payloads, guards and financial behavior remain unchanged.
- Root owns Git/gates/resource handoff/evidence. Workers are source-only, not alone in the checkout, and never revert others. Heavy commands/hooks/normal commits require fresh sole peer handoff; actual exit and own cleanup immediately release peers before diagnosis/QA. Source implementation and static review can run in parallel.
- Preserve original browser budgets/retries. No forced clicks, fabricated auth/mutation responses, vendor/billing feature changes, scanner weakening or false paid-execution evidence. Use protected actual API authority.

## Review focus

- Locale changes during organization/candidate reads, paid start, recovery, query/cancel and polling retain pending ownership, locks, request counts and form/UUID values.
- Known failure/reason labels translate; unknown raw protocol data stays verbatim. Errors must not persist stale translated strings across locale changes.
- Six modality payloads and output shapes, unknown versus zero usage, six-decimal exact costs and original currency/native units remain exact.
- Held/unconfirmed outcome warnings and cancellation limitations retain their meaning; locale never authorizes or releases funds.
- One protected setup POST for a unique unregistered model establishes an actual failed/adapter-unavailable historical record before financial reservation/vendor dispatch; subsequent recovery/GET/permission outcomes are observed, never seeded as mutation success. All image/data/privacy limits are recorded.

### Task 1: Complete namespace, semantic display and component acceptance

**Own files:** components/admin/platform-model-testbench.tsx; new lib/i18n/namespaces/model-testbench.ts; messages/en.ts and zh-CN.ts; new tests/ui/platform-model-testbench-i18n.test.tsx. Existing tests/ui/platform-model-testbench.test.tsx remains byte-identical. Paths above are under apps/web/.

- [x] StageA: new English/locale tests only. Exercise all owned states/forms/result types, deferred ownership/call counts, exact raw values and payloads, safe failure semantics and faithful financial warnings. Reuse installed matchers and canonical types; schema/collection mistakes are not intended RED.
- [x] Root freezes tests and runs native focused RED with all old tests and resource controls; original implementer makes no production edits before root's explicit semantic-RED release.
- [x] StageB: minimum complete page/namespace implementation. Preserve state/effect/call graph and financial helpers; new known reason is display-only. Add bounded stable selectors if needed for native evidence; audit375 label/control wrapping.
- [ ] Root focused GREEN/types/scoped lint/init/raw-error gate, normal commit and independent source/task review. Reuse unchanged evidence rather than repeat unrelated suites.

### Task 2: Actual-route historical recovery and permission acceptance

**Own files:** a dedicated model-testbench fixture/browser spec with additive canonical config/seed wiring only if necessary. Preserve all old fixture values, actors, imports and cases; detail the exact frozen ownership before dispatch. Root owns docs/evidence/publication.

- [ ] Finalize canonical protected unavailable-adapter setup POST and real actor authority. Strictly validate request/201 failed response and independent GET; no synthetic SQL, adapter registration, financial receipt or successful execution/cancel outcome. Reuse existing dedicated platform superuser/member org actors.
- [ ] Append one bounded actual route journey: real login/org/candidates, original UUID recovery/readback, locale zero redispatch, terminal cancellation remains disabled, ordinary/foreign-owner denial and untouched raw content. Parameterize375/1280 viewport captures with full warning/control bounds.
- [ ] Source gates and exact isolated discovery; one native run, actual exit/owned cleanup and immediate release before report classification/image QA. Fix only real i18n/driver issues; record unrelated business defects separately.
- [ ] Independently inspect every final PNG and safe evidence, task/runtime review and strongest final whole-branch review. Bind metadata-only publication to actual product source.
- [ ] Canonical credential scan, normal hooks/push, automatic PRCloses6246 targetingdevelop. Main checks CI/queue and actual merge; first actual relevant failure remains this worker's responsibility. Update6133 route/owner/issue/status without claiming uncovered pages complete.
