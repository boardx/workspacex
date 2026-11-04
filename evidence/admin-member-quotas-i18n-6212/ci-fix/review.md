# Bounded CI repair review

CLEAN — no actionable P1/P2 findings.

Reviewed exact `c6a5477cfa1482ffad824784a8866c49861310d0..b77667140dd130abffb2c9205c49b394a79dd9db` against ci-fix-brief.md and ci-fix-review.diff. Git confirms only the assigned UI test file changes; production, API, locales, E2E and configuration are unchanged. Independent byte comparison confirms setup and all seven other original cases remain unchanged.

The existing 403 case uses a real Response status through the fetch mock, requires permission/contact-administrator guidance, rejects expired-session/relogin text, and preserves failure-prefix, FORBIDDEN nonleak and absent-live-data assertions. The added independent 401 case exercises the same component/fetch path with HTTP 401, requires authentication/relogin guidance, rejects permission/admin guidance, and checks UNAUTHORIZED nonleak and absent live data. Assertions use literal visible expectations rather than importing implementation text. No skip, weakened assertion or changed canonical success data observed.

Evidence read: ci-fix-red.json records actual original-suite RED (1 failed, 7 passed; exit 1; 5.580s). Expanded GREEN and scoped lint are owned by root and were pending at review; reviewer ran no tests, lint, services or browser checks. This review covers the test-only repair, not whole-feature or 17-image acceptance.
