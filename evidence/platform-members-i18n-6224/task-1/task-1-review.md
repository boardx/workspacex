# Task 1 independent review

Reviewed HEAD `7153fd810d1f52752b9050300a6b58f874097b81` against BASE `73d5c5bfb20cd544e23303789a5afb8eab7b7744` using the supplied commit/stat/full-context diff. BASE is the published own-quota development dependency, **not an accepted integration baseline**. This verdict covers Task 1 only.

## Spec compliance verdict: PASS for the reviewed implementation scope

No actionable P1/P2 specification violations found in the reviewed diff.

- Page-owned copy, loading accessible name, counts, empty/denial/failure states, badges, dates, action labels and role aria labels use translated resources. Roles and navigation reuse `role.*` and `adminNavigation.item.platform`; refresh/retry reuse `adminCommon.*`. The new namespace owns new page meanings only. No duplicate shared header implementation/key is introduced.
- Failure state retains semantic known causes or HTTP/network classification, rather than private exception messages or unknown codes. Internal `DEPENDENCY_UNAVAILABLE` is no longer displayed. Role denial describes operator authority; grant/revoke denial describes superuser authority. Missing accounts and missing memberships have separate explanations.
- Notices retain raw names/organization names and canonical previous/next role IDs, translating only during render. The timer remains 4000ms and depends on notice identity, with no locale dependency. List callback/effect dependencies remain unchanged. Locale changes do not add requests, reset selection, or recreate mutation state in the changed code.
- SDK calls, operation timing, response-based local updates, viewer authority derivation, role IDs and row keys are unchanged. No production API/contract/guard files are changed. Date display changes locale while preserving `new Date(originalTimestamp)` interpretation; raw names, emails, organization values and braces remain untransformed.
- New component cases cover open-popover locale continuity, deferred GET/PATCH/POST/DELETE, canonical request paths/bodies/counts, unrelated-membership preservation, semantic errors, operator/superuser/ordinary display distinctions and the original banner boundary at 3999/4000ms after a locale switch at 2000ms. They explicitly claim component evidence only. The authored-data exclusion in the full-page CJK assertion is limited to exact authored elements and the corresponding avatar initial, whose preservation is asserted.

## Code quality verdict: PASS for static review

No actionable P1/P2 quality findings found. The page-local discriminated unions keep semantic intent separate from display strings; the small failure renderer centralizes contextual copy and safe fallback handling. Namespace registration is minimal. The existing nine-case file changes only the 503 assertion to require readable failure/retry behavior and reject the internal enum; its request fixture and no-old-list assertion remain. The raw-error ratchet changes exactly this page's existing entry from 3 to 0, retaining the entry and unrelated budgets.

One focused outside check inspected the existing `PopoverSelect` implementation in `apps/web/components/org-admin/org-admin-screen.tsx:558`: open state is local and does not depend on locale/options identity; current labels and aria copy derive from current props/resources. Its fixed trigger width, minimum popover width and truncation mean physical narrow-layout acceptance still needs actual browser inspection. Page-owned wrapping changes are reasonable static preparation, not proof of reachability.

## CannotVerify / required remaining checks

- Root reports 32/32 component/resource tests and scoped six-file ESLint passing at `74a9e1e28eda80f84725cf1c0330f021797918d9`. The supplied diff is consistent with those assertions and with `7153fd` being the numeric ratchet change only. I did not execute these gates or independently inspect their private raw receipts, so this is reported root evidence, not a reviewer rerun.
- Root must finish and record the raw-error scanner GREEN plus its four selftests, web typecheck and `./init.sh` at the actual final source. These were explicitly pending in the supplied current validation record. In particular, init/source gates must confirm compatibility of the shortened page header comment (the old `lint-no-backend-badge:backed-by-children` annotation was removed); no checker failure is established by this review.
- Full shared-shell English behavior relies on published parent `73d5`; acceptance/integration of that parent remains outside this verdict. Reconcile/revalidate if the eventual accepted parent differs materially.
- Actual backend authorization, persisted mutation/reload checks, original actor privileges and visually inspected 375/1280 screenshots remain Task 2. No browser, backend, CI, PR-delivery or whole-feature completion claim is made here. Use the planned real browser matrix to confirm long authored values, full grant/revoke controls, popover edges/options and inline errors remain readable and reachable.

Review was read-only except for this requested report. No native gates, Git commands/mutations, services, source changes or subagents were run. The diff was read once, with bounded follow-up reads solely for output-truncated portions; no repository crawl was performed.
