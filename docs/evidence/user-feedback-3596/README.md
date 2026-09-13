# Feedback #3596 verification

Registration retains mandatory email verification. Only a newly consumed challenge matching the registering browser’s signed HttpOnly proof can issue the standard bearer session. Replays and cross-browser confirmation remain verification-only. Existing login state is preserved. Session failures offer normal login recovery.

- `./init.sh`: exit 0, standard fast health check.
- `PGPORT=55496 REDIS_PORT=56396 COMPOSE_PROJECT_NAME=feedback-3596 WORKSPACEX_DB=feedback_3596 pnpm --filter @repo/api exec vitest run tests/auth/email-verification-public.test.ts --maxWorkers=1 --minWorkers=1`: exit 0, 33 passed using real isolated PostgreSQL and Redis. Includes concurrent single issuance, replay, expiry, wrong browser proof, superseded link, normal session membership/TTL and session-store failure recovery.
- `pnpm --filter web exec vitest run tests/ui/email-verification-public.test.tsx tests/ui/bootstrap-first-admin.test.tsx tests/ui/registration-field-errors.test.tsx --maxWorkers=1 --minWorkers=1`: exit 0, 17 passed. Includes bootstrap automatic login, authenticated-session preservation and cross-tab protection.
- Password login and session-store failure regression suites: 24 passed in the initial combined API run. That run’s email suite timed out in startup under duplicate typecheck load; the separate single-worker run above passed. An initial test incorrectly assumed registration creates only one organization; corrected it to compare against standard login memberships, including the existing personal organization.
- Browser journeys and final typecheck/lint/CI are pending at this commit. No claim of completed delivery or merged state.

Log files contain the tail of each actual command output, not a replacement for its full output. The temporary API test compose stack was removed after tests.
