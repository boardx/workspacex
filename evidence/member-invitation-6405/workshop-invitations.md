# Workshop invitation email verification

Existing coverage: general ProjectInviteCard already supports actual transactional email, link copying, expiration/revocation and pending invitation management. Organization invitation email/link behavior already implemented by #6316. Workshop settings mounted ProjectInvitePanel with links only.

Added: optional validated recipientEmail to canonical issueInviteLink input, optional emailDelivery sent/failed output, configured transactional transport delivery after existing persisted-role authorization; server constructs /projects/join?t URL. Workshop UI exposes email send and localized success/failure; failed mail preserves copyable issued link.

Executed successfully:
- `pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter @repo/api exec vitest run tests/project/project-permission-chain.test.ts`: 2/2, actual Nest HTTP + PostgreSQL. New mail test covers persisted facilitator, nonmember and other-tenant denials without sending, configured transport spy, delivery failure then copy-token acceptance. Existing permission chain passes. Isolated DB peak 7 connections; wrapper cleanup completed.
- Same isolation wrapper, `tests/project/workshop-invitation-email.test.ts`: 4/4 controller unit tests; mocked authority, not DB evidence.
- `pnpm --filter web exec vitest run tests/ui/project-workshop-invite-email.test.tsx`: 2/2 after en/zh localization.
- `pnpm --filter @repo/api exec tsc --noEmit`: exit 0.
- API lint-error-leak: exit 0, 209 interface files.

Limits: controlled configured transport spy verifies delivery invocation; no external recipient inbox assertion. Workshop email deliberately delivers existing shared bearer links, so it is not email-bound; acceptance still requires existing organization identity/login. Existing expiration/revocation and workshop membership paths unchanged. Issuance remains idempotent; repeated email submissions may send again. Existing workshop issuance has no delivery cooldown/history; this change does not claim exactly-once mail. UI disables duplicate requests while pending.
