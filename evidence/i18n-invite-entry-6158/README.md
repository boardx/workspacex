# Invitation entry localization — #6158

Implementation reviewed at faf04bc7bade8739fdbe982178d65333cb6148c7 against account-entry base 2fbe544f39084eaa7e81a728246e73a801bb6b6f. Independent read-only review found no actionable issues. Latest main/develop fetched and foundation merge incorporated without changing queued earlier PR heads.

- `red-summary.log`: selected pre-implementation failure lines; five acceptance tests failed on untranslated English UI. Original run exited 1.
- `unit-tests.log`: 27 tests/four suites passed, including five new live-locale/input/payload/claims/preserved-session tests plus existing unavailable recovery and 13 invitation-session regressions and five resource checks. Final run uses WORKSPACEX_WEB_TEST_MAX_WORKERS=1 after canonical password-policy reuse and develop synchronization. Successful activation fixtures are parsed by each canonical output schema before rendering, so the preserved-account locale test cannot rely on a partial fake response.
- `hook-invariant.log`: actual useInvitationSession function body byte-identical to base; only its typed display key map and a type-only import changed.
- `secret-scan.log`: zero new hits; no scanner/baseline changes.

Components use real rendering and the real session hook, with API/session edges mocked. These tests do not establish real invitation issuance, account creation, mail or backend authorization.

Browser passed after the explicitly serialized shared-machine window; normal mandatory pre-push affected gates passed 25/25 (23 cached) in 28.334 seconds. Registered i18n-entry.spec.ts now includes a third test for both public activation token modes, original pending values, existing-account login guidance, missing token, 375/1280 overflow and English system text. It submits no real invitation.

Raw tokens/claims/profile input, endpoint paths/payloads/session guard and redirects unchanged. Display errors keep MessageKey/parameters in state and retranslate at render time; locale changes do not repeat activation. Completion keys remain a single typed map keyed by the existing completion enum. Password-policy copy reuses account.reset.policy. Logs normalized only at line endings; red log is explicitly a filtered summary.

## Public browser acceptance

`pnpm --filter web exec playwright test --config playwright.organization-create.config.ts e2e/i18n-entry.spec.ts --workers=1 --max-failures=1` passed **3/3 in 20.5 seconds**, including the two earlier entry regressions and the new invitation route test. `browser-list.log` proves only one file/three tests. Four screenshots visually checked: single/shared, 375/1280, original inputs retained and English system copy fits. Existing-account anonymous guidance and missing-token zh/en state also pass. No API mocks or real activation submission in this public browser journey. Next server and port are cleaned by Playwright; no Docker started.

The first browser run failed because a whole-shell `innerText` check included the unselected native language option autonym “简体中文”. Preserved in browser-autonym-failure.log. The corrected assertion explicitly requires locale value en and removes only the language switcher from a cloned DOM before checking all remaining system text for Han characters. Product code was unchanged; language names intentionally remain autonyms. Original private values are asserted separately and never translated.

Final independent read-only review at a49ce2c3ad5fc54d68b15736b04be657e6c568b7 found no new actionable issues; product code unchanged since faf04bc7. pre-push-summary.log selects the actual successful normal push summary. Later commits normalize evidence whitespace only.
