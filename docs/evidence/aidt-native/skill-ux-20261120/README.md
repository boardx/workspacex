# Six-stage Skill interaction and student workspace revision

Direct user request, based on `develop` **8ee7de2bcc7f26b472f8432d3e45e6b659d73477**; freshly fetched again after the explicit request to pull latest. Requirements source: [full V2](../../../requirements/aidt-v2-full.md) plus the user's explicit per-round confirmation and UI simplification instructions. The newest uploaded text could not be retrieved; it is not claimed to have been reviewed beyond the already pasted full V2.

## Implementation

- New immutable `aidt-methods@1.4.0`, six stable Skill identities; preserve every old release/source byte and thread pin. Future bootstrap/explicit new-version selection uses the new package. A merge does not update deployed images or silently migrate existing chats.
- Each Skill receives ten sequential source revisions with concrete gaps, cases, checks and intermediate SHA256 records: [S1](s1-iterations.md), [S2](s2-iterations.md), [S3](s3-iterations.md), [S4](s4-iterations.md), [S5](s5-iterations.md), [S6](s6-iterations.md). Later user confirmation instructions are recorded separately; the original ten rounds are not rewritten.
- Student input first; one useful missing item at a time; continue existing material rather than restarting. Actual substantive revisions end with a brief result, student confirmation and next action. Pure clarification does not manufacture a completed result.
- Opening hints use the existing native Chat host, with a collapsed blank scaffold instead of prefilled answers. The third step restores the unexpected-finding/none checkpoint before persona.
- A compact result confirmation saves through the existing shared-stage CAS controller. Its field records a student review bound to the full draft, project, step and exact source revisions. Only a matching saved server projection exposes the guided Continue action. Changing content or sources invalidates that review; failures/conflicts retain the draft and allow retry. It is not a permission, evidence-validation, teacher-grade or unanimous-vote authority.
- New-group creation asks only for the group name. Course management is secondary; the project removes persistent teaching/process walls and keeps native Chat, outcomes, optional materials and the global member-text plugin.

## Evidence and limits

The ten rounds are actual prompt edits and structural/counterexample checks, **not ten provider-model, browser, classroom or production acceptance rounds**. Sixty independent agent probes exercise the final instructions with raw student requests; these are separate from the WorkspaceX runtime and supplier model. The probes retain missing evidence and student choice, but cannot establish behavior of a deployed model.

Local regression: 99 Web AIDT test files / 849 tests passed; 7 API pack/isolation files / 50 tests passed; exact context release verification / 10 tests passed. The confirmation interaction has explicit success, failure, edit invalidation, read-only and content/source/group binding coverage. These are DOM/unit/service-double checks; no fresh live multi-user or classroom E2E is claimed.

UI screenshots are controlled local renders of the actual React components using synthetic data, not a live authenticated full-stack session. See [UIUX review](uiux-review.md). No claim of a validated 9/10 usability score is made.

No deployment, user account changes, permission changes or human design-signoff edits. The coordinator tick reports the existing missing `COORD_GATEWAY_URL`; readiness is available. This ad-hoc user request is outside the readiness queue. GitHub Issue creation was rejected by approval review and was not retried; the authorized PR references the existing related work.

## Reproduction

```sh
./init.sh
pnpm --filter @repo/api exec tsx scripts/build-aidt-methods-pack.ts --check
pnpm --filter @repo/api exec vitest run --config vitest.aidt-isolation.config.ts
pnpm --filter @repo/api exec vitest run --config vitest.aidt-run-context.config.ts tests/aidt-run-context/approved-pack-unit.test.ts
pnpm --filter web exec vitest run aidt --maxWorkers=2 --minWorkers=1
pnpm --filter web typecheck
pnpm --filter web lint
pnpm --filter @repo/api typecheck
pnpm --filter @repo/api lint
```

Launch through the repository's normal local stack, open `/aidt`, create a group, enter a step and open **本步成果**. Review required outputs, confirm and save, inspect the server version, then continue. Preserve normal membership checks. For an existing thread, explicitly select the new package through the existing version-update action; do not infer its mounted version from its stable name.

## Integration follow-up: retain extra brainstorming without blocking three sheets

The original full-run receipt contained a temporary screenshot-capture test that was removed after capture. The final reproducible run is 99 files / 849 passed; the final confirmation suite has 8 tests included in that total. Historical logs are retained separately, not added together.

Two red counterexamples showed an unfinished fourth idea blocked three complete PDFs. The final preview builds only complete sheets and, when more than three complete candidates exist, lets the student select the current preview set. Unreadable-image or same-name candidates can be excluded without deleting their notes. At least three distinct, readable sheets remain required; changing the selected set resets review and invalidates an in-flight old print. The chosen prototype idea must have a complete sheet. The student confirms that the PDF files and the chosen idea sheet can actually be viewed; neither a print request nor this declaration is an automatic file-authenticity certificate. This is temporary print selection, not shared voting or a new service contract.
