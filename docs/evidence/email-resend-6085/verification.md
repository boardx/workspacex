# Email verification recovery — #6085

User approved email/password recovery and the implementation plan on 2026-11-02.

- `./init.sh` — exit 0 (dependency/basic startup checks; not full repository suite).
- `pnpm --filter @repo/api exec vitest run --config vitest.email-recovery-unit.config.ts` — 6 passed. Tests failed before the shared password proof and recovery use case existed.
- `WORKSPACEX_DB=wsx_mail6085 COMPOSE_PROJECT_NAME=wsx-mail6085 pnpm --filter @repo/api exec vitest run tests/auth/email-verification-public.test.ts --maxWorkers=1 --minWorkers=1` — 36 passed against PostgreSQL and a real Nest HTTP server. Covers expired/missing cookie, failed outbox recovery, concurrent resend serialization, old token invalidation, invalid credentials and daily quota for both cookie/password paths.
- `pnpm --filter web exec vitest run tests/ui/login-real-error.test.tsx tests/ui/email-verification-public.test.tsx --maxWorkers=1 --minWorkers=1` — 14 passed; new resend interaction failed before implementation. Request failure leaves retry enabled; success applies cooldown.
- API and web `tsc --noEmit --pretty false` — exit 0.
- `git diff --check` — exit 0.

The first full API attempt hit the existing 120-second beforeAll timeout on cold startup and executed no tests. The next run exposed a test comparing request-specific trace IDs; the assertion now compares status/error/reasonCode. Final API run above passed all 36 cases without raising timeouts.

Production delivery configuration was repaired separately earlier in #6085, with user-confirmed receipt. This code change has not been deployed; local HTTP/PG verification is not production browser evidence. No email_verified_at field is modified by the recovery path; email confirmation remains the normal one-time token flow.

Additional regression: `WORKSPACEX_DB=wsx_mail6085 COMPOSE_PROJECT_NAME=wsx-mail6085 pnpm --filter @repo/api exec vitest run tests/auth/login-password-auth.test.ts tests/auth/login-lockout-ratelimit.test.ts tests/auth/login-enumeration-guard.test.ts --maxWorkers=1 --minWorkers=1` — 41 passed across 3 files.

Independent read-only security review of b3e9977de..d16ce4a662ef237092cd09289bdbd4d6233d4243 found no actionable findings. Reviewed shared lockout/password proof, enumeration, transaction lock order, quotas, UI retry handling and contracts. No production verification claimed for this code.

Owned PostgreSQL/Redis compose stack wsx-mail6085 released after verification.
