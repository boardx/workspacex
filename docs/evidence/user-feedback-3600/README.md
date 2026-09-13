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

Initial regression: the single-recipient activation assertion failed with `expected undefined to match object` for the new session output. Final targeted run: API 32/32 and UI 17/17 passed, including concurrent/replayed activation, committed activation followed by session-store failure, existing-session preservation and cross-tab account changes. API typecheck and contract-source validation exited 0. Real-browser t/lt verification passed 2/2 (6.2s and 6.6s test bodies; 9.5 minutes including the cold production build). Both cases assert correct identity/organization, real project-list access, refresh persistence, and no navigation through `/login`. Screenshots are `invite-t-projects.png` and `invite-lt-projects.png`. The final pre-push typecheck/lint and PR CI results are recorded on the PR to avoid creating an evidence-commit/push loop.

## PR review: atomic cross-tab replacement

The review identified a real check-to-write race between the invitation helper's token comparison and session persistence. The correction moves the expected-token check inside a shared Web Lock. Standard login/logout, organization switching, invalid-session cleanup, and all three live-page bearer writers participate in that lock. The synchronous metadata/token/revision commit is locked; network hydration is not. Automatic replacement fails closed when Web Locks are unavailable, while explicit password login remains available.

The actual SessionProvider, session API/login-gate and invitation suites pass 40/40. Removing the lock-internal expected-token check makes the deterministic queued-other-login test fail (`expected 'fulfilled' to be 'rejected'`); restoring it passes. A late deletion event cannot clear a newer login. Fresh browser verification passed 3/3: t 9.7s, lt 10.7s, and a real three-page Web Locks queue 11.6s (7.9 minutes including the build). The competing password login commits first; the invitation preserves its bearer/identity and does not navigate. Web typecheck also exited 0. The previous CI failure in `core-journey-02-org-management.spec.ts` was an obsolete assertion requiring the activation success page and `/login`; it now checks direct project access and refresh persistence, retaining the administrator member-list assertion. That original failing journey passed 1/1 (7.5s) against the same live stack without another build. Its temporary runner config/lifetime barrier were removed, and the stack was released.
