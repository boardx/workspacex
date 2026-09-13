# Issue #3600 — invitation registration session handoff

The reported entry was shared invitation activation. Both `?lt=` and single-recipient `?t=` previously created the account and issued a Redis session, discarded its bearer, then directed the user to password login. This correction delivers the same issuance as an `AuthenticatedSession` and hydrates the standard browser session before entering `/projects`.

No invitation tokens or personal emails from the report are retained. Existing invite validation, email-verification policy and grants are unchanged. The single-use transaction rejects replays; shared links permit different users but reject an existing normalized email. The browser preserves an existing account and a concurrent tab's changed session. A failed session issuance/identity hydration offers password-login recovery instead of presenting another activation attempt as the recovery mechanism.

## Verification commands

- `./init.sh` — passed dependency installation and default quick health verification (not `--full`).
- `pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter @repo/api exec vitest run tests/auth/member-invite-activation.test.ts tests/auth/shared-invite-links.test.ts`
- `pnpm --filter web exec vitest run tests/ui/invitation-session.test.tsx tests/ui/invite-activation-unavailable.test.tsx`
- `pnpm --filter @repo/contracts gen:mock`
- `node .harness/scripts/lint-contract-source.mjs`
- `pnpm --filter @repo/api typecheck`
- `pnpm --filter web typecheck`
- `FULLSTACK_E2E_SERVER_TIMEOUT_MS=900000 pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter web exec playwright test --config playwright.fullstack-smoke.config.ts --project=seeded --no-deps core-journey-01-registration.spec.ts --grep '邀请注册'`

Initial regression: the single-recipient activation assertion failed with `expected undefined to match object` for the new session output. Initial corrected run: API 31/31 and UI 15/15 passed. Additional failure/concurrency cases and real-browser verification are pending at the initial review checkpoint; final results will be recorded before PR creation.
