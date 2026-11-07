# Whole-branch SOURCE review — #6212

Comparison supplied by root: `bfb608070b6ebb77156e63fde2d7f6b7c97101a6` → `0084ad8426a3d87c68a1d006d0a914d78f2b3705`. This is the single whole-branch source review of the explicit profile6203 stack, not a review of main/develop integration or merge approval.

Read binding design, implementation plan, README and the SDD progress rulings, including the explicit ruling permitting source review before the held live acceptance. Reviewed the supplied 72-file, 6,135-line diff in bounded ranges. Initial oversized outputs were truncated; recovery reads recovered omitted ranges and occasionally overlapping context. No changed product files were separately reread. Reports and recorded check outputs were assessed as evidence supplied by root, not independent dynamic proof. No tests, type checks, lint, init, builds, browsers, databases, resource operations, Git commands or subagents were run. This report is the only write.

## Strengths

- The three tasks integrate through pure typed namespaces and shared presentation helpers. Locale reaches render-time labels and feedback without entering request dependencies, query objects, identity keys or state-reset paths. Stored callback feedback is wrapped correctly for React state setters; raw-cause wrappers retain falsey/function error presence.
- Quota and rule writes retain IDs, enum values, trimming, Number/finite validation and Math.trunc. Domain rejection details retain actionable remaining/allocated amounts. Generic errors use the canonical safe failure policy, and the minimally expanded invitation fallback no longer exposes unknown reason codes or exception messages.
- Shared invitation status lookup, form/onNotice and activation-link components are reused. Known invitation error handling, review/idempotency/cooldown conditions, empty team ID and raw activation URLs remain intact.
- Usage helpers preserve exact BigInt arithmetic, separate raw currencies, financial hundredths, null/zero/native/unknown distinctions and default Chinese output. Shanghai query boundaries, canonical days, bucket math, snapshots and microsecond cursors remain unchanged. Corrected failed-call copy no longer promises zero measured tokens for every failure.
- Shared layout changes address wrapping and table containment without modifying queries or financial behavior. Prototype sections retain explicit static-data/no-live-backend disclosure and their handlers still make no backend writes.
- New semantic tests exercise drafts, deferred completions, safe errors, raw authored data, no locale reads, canonical writes, date validation, grouping, cursor/self scope and precision. The old raw-FORBIDDEN expectation was replaced with safe actionable feedback while retaining the no-mock-fallback assertion.

## Issues

### Critical

None identified by source inspection.

### Important

No new actionable P1/P2 source defect identified. Prior task-review P2 fixes are present in the complete final diff: canonical generic failure delegation, shared invitation fallback safety and truthful failed-token explanation. The later MemberFeedback annotations are erased typing changes; the removed unsupported role-query option leaves its exact string name intact.

**Acceptance remains incomplete and blocks merge.** The full spec-gate run ended at budget exit 124; it is not a pass. The new real-browser case and fixture have not been executed, and none of the planned 12 final screenshots has been inspected in this review. This is a known pending gate, not a newly discovered product regression and not waived by this source verdict.

### Minor / recommendations

The browser no-refetch counters cover requests under the organization URL prefix. They must not be reported as proof of zero requests across the entire application or personal-layer/access-log endpoints. Likewise the locale switches in the new browser case exercise quota/rule drafts and the default usage view; retained selected filters, cursors, expanded details and invitation interactions have semantic unit coverage but are not established as live-browser facts by those statements alone. Preserve these distinctions in final evidence and complete the binding live filter/draft acceptance before accepting the feature.

## E2E source assessment

The new journey uses real login, actual application requests and schema-parsed real responses. It does not intercept routes or substitute mock API results. Budget/member mutations assert the canonical body, reload persistence, actual quota rejection details and later unchanged snapshot after ordinary-member denied writes. Rule create/edit/delete uses the existing POST/PATCH/POST-delete paths and retains raw degradation target identity. Source controller inspection supports the expected 409 quota conflicts, administrator guards and normal mutation method semantics. The four new historical receipts are private-tenant read prerequisites, explicitly separated from model execution or settlement claims. Native/unknown records and CNY/USD fixtures support the intended read assertions; execution and seed/schema compatibility still require the actual lane.

The planned capture helper checks document overflow at 1280/375, and selected modal actions are checked in the viewport. These are useful executable assertions, but cannot prove text readability, clipped controls, nested scroll usability or screenshot quality until run and visually inspected. Full-page screenshot creation alone is not screenshot QA.

## Focused outside-diff reads

These were limited to named concrete integration risks:

- `apps/web/lib/design-failure.ts` and `http-failure-text.ts`: whether the newly reused fallback actually prevents unknown code/body/exception leakage and accepts render-time locale. Confirmed canonical safe fallback and own-property checks.
- `apps/web/lib/live-org-admin.ts:240–332`, targeted org-admin contract path matches, and `apps/api/src/interface/controllers/org-admin-management.controller.ts:480–617`: whether browser response predicates/payloads/status/403 expectations match the actual mutation/read routes. Paths, bodies, conflict mapping and admin checks align. An initial guessed controller filename did not exist; the focused path search located the actual controller.
- `apps/web/lib/live-ai-usage.ts` and targeted `packages/contracts/src/ai-usage.ts` operation paths: whether the final actual summary request and organization-prefix request counters target the reused panel API. They do.
- Targeted `pg-limit-rule-repository.ts` create/degradation references: whether the browser's raw target and missing-target scenario use the existing storage path. No product behavior was changed. Searches in `pg-token-quota-repository.ts` did not locate remainingTokens handling, and a guessed standalone application filename did not exist; no claim of independently verifying the repository's remaining-amount arithmetic is made.

No broad backend, pricing, authentication or repository audit was performed.

## Declined-to-judge behaviors — executor must rule

- **Actual browser/API/PG success, persisted fixture compatibility and exact response timing:** execution is explicitly held by the root/user-priority ruling; source and mocks do not establish runtime success.
- **Desktop/mobile usability and all 12 screenshot quality checks:** no rendered final artifacts have been supplied or viewed. In particular long English tabs, dialogs and tables need the planned real geometry/interaction checks.
- **Full spec-gate completeness:** the recorded command was budget-stopped. Root must obtain a real completed result.
- **Broader inherited organization-switch races or duplicate-submission behavior in quota/rules:** unchanged load/submission lifecycle was explicitly preserved by the binding scope; this review does not certify those pre-existing behaviors as race-free.
- **External model quality/execution, billing settlement, pricing and funds provenance:** display-only scope; the historical receipts deliberately do not prove these outcomes.
- **Complete `/usage` wrapper/B9 localization:** this branch reaches reused B8 panel/ledger components, but full B9 route coverage is expressly outside scope.
- **Prototype policy enforcement:** the tiers/task grading remain local demonstrations. Their translated display does not establish enforcement.
- **CI green, PR acceptance, merge and feature passing:** owned by root/main and require live checks and integration state. No Git or remote-state queries were made here.

## Verdict

**SOURCE CLEAN** for the supplied complete comparison: no actionable new P1/P2 source finding. **NOT READY TO MERGE** until the pending full spec gate and actual browser/API/PG plus screenshot acceptance are completed, followed by required publication/CI/integration gates. Recorded root unit/type/static results are acknowledged as supplied observations, not independently rerun checks. Any actual browser findings belong in the root's planned single combined fix wave and one scoped rereview; this report does not request a second whole-branch review.
