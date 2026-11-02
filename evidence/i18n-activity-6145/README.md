# Structured activity evidence — #6145

The change is stacked on profile PR #6144 at ad4b551075fd4b1934a4196e7b5a7381897803b9. Metadata is explicitly requested by structured-v1; legacy responses retain summary-only strict shape. Display params are whitelisted; no raw detail or credentials are exposed. Frontend metadata parsing falls back to summary without regex rewriting.

- Contract and UI acceptance tests first failed for the missing opt-in request/metadata display. Final scoped suites: 8 contract tests, 11 API/controller tests, 24 UI/resource tests.
- Unsupported versions initially threw raw ZodError; query-validation-red.log records the failing controller assertion. Reusing existing ZodBodyPipe makes it ContractValidationError/400. Global exception handling is unchanged.
- Real Chromium → Next → API → PostgreSQL self-service-profile journey passed: legacy response contains no display, negotiated response validates, unsupported version returns400; English/Chinese summary templates preserve the real saved user name. Existing profile save/reload/password/login and responsive assertions still pass. Wrapper exit0,1m12s including cleanup; owned compose stack removed.
- API/contracts/web typecheck and API/web lint ran before the final local validation-pipe fix; those earlier logs are explicitly named. Final normal pre-push/CI gates must still pass for the final head; no earlier-head result substitutes for them.
- Independent read-only security/compatibility review found no actionable findings at719ced52cbdd58be8e602fd7129c84f13b1f3c6d. Reviewer did not rerun tests.

Logs retain command output with trailing whitespace normalized. The pure API unit runner is committed as apps/api/vitest.identity-display-unit.config.ts; the regular API suite also includes the test file. No human signoff/feature-list passing status was modified.
