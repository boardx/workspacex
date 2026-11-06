# Issue #6316 handoff

Implemented/verified: see progress.md and adjacent raw verification transcripts. Plan: docs/superpowers/plans/2026-11-06-org-invitation-members.md. No formal sprint/feature state was touched.

Current next action: finish affected static checks, commit/push codex/org-invitation-members, create PR targeting develop with Refs #6316, then follow all checks/reviews until green. Do not merge as a worker. Production rollout remains separate; no production invites were consumed or emailed by tests.

Reproduce API evidence using a FRESH isolated WORKSPACEX_DB (legacy invitation fixtures persist credentials): WORKSPACEX_DB=workspacex_org6316_recheck pnpm --filter @repo/api exec vitest run tests/auth/org-invitation-members.test.ts tests/auth/admin-invite-dual-review.test.ts tests/auth/shared-invite-links.test.ts tests/auth/member-invite-activation.test.ts tests/auth/orphan-invite-resend-revoke.test.ts tests/billing/member-credit-quota.test.ts tests/billing/member-credit-continuation.test.ts tests/billing/member-credit-quota-controller.test.ts tests/billing/member-credit-quota-pg.test.ts tests/billing/realtime-voice-credit-pg.test.ts tests/billing/durable-credit-usage.test.ts tests/billing/private-credit-failure.test.ts tests/billing/credit-error-boundary.test.ts tests/billing/credit-stream-settlement.test.ts --maxWorkers=1 --minWorkers=1

Reproduce Python: cd apps/deep-agent-service && uv run --frozen --extra dev pytest tests/test_model_credit_failure.py -q. Reproduce static checks: pnpm --filter @repo/api typecheck; pnpm --filter web typecheck; pnpm --filter @repo/api lint; pnpm --filter web lint.

Resource cleanup: this session started default workspacex-kernel PostgreSQL for integration tests. On completion release only that owned stack using docker compose -f apps/api/docker-compose.dev.yml -p workspacex-kernel down -v. Child's wsx-member-credit-2e5d stack was already downed by child. No new worktree created. COORD_GATEWAY_URL is skipped per explicit user instruction.
