# Independent whole-branch review — #6202

Reviewed exact base `8afe95eb18f84ac848bee698935fe9db7de74cf5` through HEAD `0977a1f711f3a0d7efb7b9dc14587c92cedf3feb` (two commits, ten source/test files plus four evidence files). Read design, plan, progress, task review, complete diff and relevant StateShell/API/schema/fixture/config implementations. Static review only; no tests, services, database, typecheck, checkout, source/index/HEAD mutations or subagents. This report is the only written file.

## Strengths

- Product changes cover profile fields, validation, avatar outcomes, shared save/saved states, standing grants and extraction capability/permission/error/busy branches. New namespace has typed English/Chinese parity and shared resources remain canonical.
- Feedback functions are wrapped correctly when stored in React state; failures and validation resolve with current translations. Locale is absent from load callbacks/effect dependencies, preserving drafts, requests and pending state. Payloads, File identity, raw identifiers, date instant, authorization and authoritative reload paths remain unchanged.
- Ten component tests exercise raw brace-containing data, locale changes without new reads, validation, saved/avatar/revoke errors, pending revoke and extraction/member boundaries. Browser additions use real API requests, dual actors, persistence reload, byte rejection and a real image; capability branching does not alter deployment configuration.
- Grant seed uses tenant-scoped `asApp`, a valid forever/null-run row and actual admin identity. `resetOrgs(orgId)` deletes that tenant and the grant FK uses `ON DELETE CASCADE`; replay therefore resets rather than accumulating grants. Existing private fixture IDs isolate other tenants. Seeded approval creation is explicitly not claimed as evidence.

## Issues

### Critical
None found.

### Important

1. **[P2] Saved assertions query a role the actual success element does not expose.** File: `apps/web/e2e/entity-localization.spec.ts:67` (also line 69). After the successful profile PATCH, this waits for `getByRole("status")` containing Saved/已保存. `StateShell` success renders a plain `<p data-testid="saved">` without `role="status"`; the avatar status element is unrelated and not present here. The real browser test deterministically times out before avatar, member and grant evidence. Assert the existing `saved` test ID with exact localized text in both locales (or separately justify a product accessibility change); retain the PATCH payload assertions.

2. **[P2] Exact denial assertions omit StateShell’s mandatory localized layer prefix.** File: `apps/web/e2e/entity-localization.spec.ts:106` (also lines 107 and 114). After member 403 responses, StateShell renders the reason as one text node using `state.organizationRestriction`, yielding `Organization restriction: <reason>` or `组织层限制：<reason>`. There is no descendant containing just the unprefixed reason, so these exact text locators cannot match. Even after finding 1 is fixed, the journey stops before member write denials and admin revoke validation. Scope to the relevant denial panel and assert the complete prefixed text, or use a scoped `denied-layer` text assertion retaining the reason and language check.

### Minor
None recorded or deferred.

## Recommendations

Fix both browser locator contracts, then run the root-owned real browser/seed replay, regression, type and init gates in the serialized validation window. No product localization defect was found in this review. Source inspection supports reset isolation but does not replace executing the promised two seed runs.

## Declined to judge

- HITL approval creation and actual later tool execution after revocation: intentionally outside this localization slice; the seeded existing authorization only supplies the prerequisite for real list/revoke checks.
- Independent correctness of inherited Nav #6201: this review range starts at that dependency’s base; its implementation is not part of #6202. Actual merge and zero inherited delta remain required before publishing an independent profile PR.
- Live browser, seed replay, broad regression/type/init and CI outcomes: not executed because this reviewer was explicitly restricted to static review and the heavy window belongs to another chat. Parent-reported ten-test GREEN and ESLint 0 are not represented as reviewer-run evidence.

## Assessment

**Ready to merge: No — fixes and validation required.** Two new browser assertion mismatches prevent the promised real-user acceptance journey from completing. Product source is statically sound, but the real validation gates and Nav dependency integration remain outstanding; this is not a completed multi-feature PR.
