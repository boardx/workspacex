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

Root covering static checks at f443de1bf62193e5085435762639507875e58eac: webtype0, exact E2E ESLint0, testid0, isolated exactlist1test/1file exit0. Real browser stillpending; one scoped rereview waits actual covering evidence.

Rootcoveringactualbrowser source89a22/docsHEADc053 byteequalclean:1/1PASS10.2s,total4m1/cleanup1. Allnewaudit/reload/mobilefullaction/memberdenialassertionsexecuted. scopewsx-57d5c526c41d17fee319 docker0andownedportsnoLISTENafteractualexit. Command:pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter web exec playwright test --config=playwright.fullstack-smoke.config.ts --project=seeded-github-import --no-deps entity-localization.spec.ts --grep="workflow grant management persists canonical permissions" --max-failures=1. Evidence:evidence/workflow-grants-i18n-6207/final-run/browser.txt;15screensrootQApending.
