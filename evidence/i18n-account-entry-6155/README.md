# Account entry localization — #6155

Implementation head: `b41d7379b7beb7901c165e135fd21a3a329515fe`; delta base: `4fa8a0bf1` (latest develop merged before development).

- `unit-tests.log`: 35 tests, six component/resource suites: account entry, registration field errors, bootstrap first admin, public email verification and reset password. API calls are mocked at the contract boundary here; no claim of real account creation or mail delivery.
- `resources.log`: five resource key/interpolation/coverage tests. The final combined run in unit-tests.log confirms 35 tests pass.
- `typecheck.log`, `lint.log`: web TypeScript and ESLint/design checks pass. These ran before the final neutral copy and test addition; normal pre-push runs current affected gates.
- `secret-scan.log`: zero new hits; scanner/baseline unchanged.
- `browser-startup-timeout.log`: first registered public-entry browser run failed before tests: Next webServer did not start within 120 seconds while host load exceeded 159. This is **not browser acceptance evidence**. No Docker started, port 30494 released after Playwright cleanup.

Commands run from this worktree:

```sh
pnpm --filter web exec vitest run tests/ui/account-entry-i18n.test.tsx tests/ui/registration-field-errors.test.tsx tests/ui/bootstrap-first-admin.test.tsx tests/ui/email-verification-public.test.tsx tests/ui/reset-password.test.tsx
pnpm --filter web exec vitest run tests/lib/i18n-resources.test.ts
pnpm --filter web typecheck
pnpm --filter web lint
pnpm run lint:oss-secret-scan
pnpm --filter web exec playwright test --config playwright.organization-create.config.ts e2e/i18n-entry.spec.ts --workers=1 --max-failures=1
```

Logs normalized only by removing trailing whitespace. JSDom's existing unsupported document-navigation stderr in bootstrap tests is not actual browser navigation evidence.

Scope preserves endpoint paths, tokens, password/name/email values, session routing and timers. Locale changes re-render failure metadata without repeating requests. Unknown reset outcomes now use neutral copy in both languages instead of incorrectly promising the token was not consumed. Remaining account activation/invite/join/consent/session pages and other modules are outside this slice; umbrella #6133 remains open.

## Public browser retry

After the other session released its heavy-suite lock/processes, `--list` selected exactly two tests in `i18n-entry.spec.ts`. The same registered command with `--workers=1 --max-failures=1` passed **2/2 in 35.0 seconds after the animation fix**, with no API mocks. `browser.log` and five screenshots record live locale changes, cookie/reload persistence, original pending names/email/password values, reset mismatch and missing verification token. Registration overflow checked at 375/768/1280. No real registration/email delivery/reset was submitted in this public UI journey; component tests cover request payload preservation.

Visual inspection initially found Chinese Metamorphosis stage captions. Its owner explicitly reassigned this shared component and six entry.metamorphosis resources to this slice. Added a failing real-component assertion, translated only text, and retained stage IDs/timing, SVG and reduced-motion classes. The final browser adds English stage-copy and reduced-motion/layout assertions. Remaining account pages are still outside this slice.

Independent read-only review of exact implementation SHA b41d7379b7beb7901c165e135fd21a3a329515fe versus 4fa8a0bf1ce19acc08e6e20a8760e8d18ca610ea found no actionable findings. The later commits only record evidence.

The shared-animation regression failed before its translation and passed after it. Final browser-list.log confirms two tests; browser.log verifies all three English captions, no Han characters in the animation text, reduced-motion animationName none and stage-list overflow. Final screenshot visually inspected: English stage descriptions wrap within their columns.
