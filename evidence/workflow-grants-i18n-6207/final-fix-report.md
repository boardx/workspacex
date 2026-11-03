# Final review fix report — workflow grants #6207

Status: DONE (source fixes only; covering verification pending root).

## Changes

Only the workflow grant management test in `apps/web/e2e/entity-localization.spec.ts` was edited.

- Both deep-link reloads now explicitly select `workflow-grants-tab-capability` before checking the capability card's persisted grant state.
- Immediately before grant confirmation, capture event IDs from the actual initial `catalog.audit`; immediately before revoke confirmation, capture event IDs from the actual `persisted.audit`.
- Grant and revoke matching now require an event ID absent from their respective baseline, plus the existing category, action, from/to level and admin actor. Retain each matching event object and require that exact object in a real, schema-parsed GET after the corresponding reload.
- Preserve the existing grant timestamp/localized date checks and additionally check revoke timestamp validity.

## Self-review

Read the edited test block after writing it. Initial deep-link focus/workflow-view assertions, strict request and response schema parsing, actual mutation responses, locale no-refetch assertions, modal cross-tab locale propagation, screenshots, and member denial assertions remain intact. No expected audit outcomes are seeded. No product code or other test was intentionally changed. Both P2 findings are addressed in source.

## Covering checks

Pending root's serialized verification: targeted eslint/type/list checks and the exact registered browser test `workflow grant management persists canonical permissions and audit across locales with real member denial` in `entity-localization.spec.ts`. No tests, lint, typecheck, build, browser, database, Git or GitHub operations were run by this fix worker. This report does not claim passing checks or runtime acceptance.

## Concerns

No new source-level concerns found. Runtime correctness remains subject to root's covering checks and scoped rereview.
