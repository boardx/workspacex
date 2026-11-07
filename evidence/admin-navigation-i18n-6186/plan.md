# Admin navigation implementation plan

> For agentic workers: use subagent-driven development for this one task, then independent review and verification before completion.

**Goal:** shared real organization/platform admin sidebar changes language in place without changing canonical routes, roles or counts.

**Architecture:** typed namespace owns controlled default strings; existing metadata exports derive the same values. Render-time translation uses stable module keys. Current provider/query APIs remain unchanged.

**Spec:** evidence/admin-navigation-i18n-6186/design.md and issue6186.

## Task 1 — Localize canonical labels and actual sidebar

Ownership: only apps/web/lib/admin-nav-metadata.ts, apps/web/components/admin/admin-nav.tsx, new apps/web/lib/i18n/namespaces/admin-navigation.ts, and the two messages aggregates. Do not edit tests, browser files, provider, query hooks, API, config, partition/workflow, budgets or other module files. You are not alone; preserve others' edits. Do not commit or spawn helpers/reviewers.

- [ ] Read evidence/admin-navigation-i18n-6186/design.md first. The original292WIP branch is preserved; current fresh branchworker/i18n-admin-navigation-6186 is basedactualdevelop44ae with only restored2redtests so far.
- [ ] Fresh red tests are tests/ui/admin-nav-i18n.test.tsx (2expected failures,3.87s). Implement until they pass; do not weaken assertions.
- [ ] Keep all canonical metadata values/shapes/keys/URLs/UCrefs and all22item/4group/2scope values unchanged. /tmp/admin-nav-6186-fresh-before.json is the independent baseline; produce an after snapshot with the same keys and compare.
- [ ] New dedicated namespace owns all controlled labels, scope intros and count text. Require all item keys with a type-only AdminModuleKey reference. Move existing navigation.admin/platform-admin entries by reference, no duplicate title facts or runtime cycle.
- [ ] Render using existing useI18n, keeping source group React keys and module/link/current/testid/scope. Group translation lookup derives from namespace group entries, not another label table. Keep countSources/live query args and locale-independent query key unchanged.
- [ ] Preserve em dash vs0. Accessible English names required by tests: Organization admin modules, Platform admin modules, Count for Overview: 0, MCP count unavailable; unavailable tooltip includes not zero. Chinese defaults retain original display labels.
- [ ] Existing resource keys use one namespace import/spread appended to each aggregate; preserve all sibling resources. Existing navigationLabel helper may translate currently reachable secondary labels; secondary filtering and stable data remain unchanged.
- [ ] Run focused2tests and targeted ESLint with max1worker. No init/fulltsc/Next/PG/push while phase2 holds heavywindow. Report commands/exits, exact changedfiles, metadata comparison and any concern to task-1-report.md.

## Task 2 — Controller verification and browser

- [ ] Strengthen no-refetch and metadata/asset/scope/count regressions, resource parity and original test set.
- [ ] Append actual sidebar route/locale/link/count/reload/small viewport browser to existing registered entity-localization spec, using current actors and real API/PG; no request interception or config changes.
- [ ] Coordinate phase2→root→phase1 heavywindow; actualbrowser theninit/normalpush with standard hooks.

## Task 3 — Review and delivery

- [ ] Independent taskreview and most-capable final whole-branch review, fix findings, then newheadCI and actualcandidate under main-only queue writes.
- [ ] Open independent PR Closes6186 todevelop automatically, record truthful route/role/boundary in6133 matrix, then continue own B8 profile slice while following existingPRs.
