# #6405 handoff

## Verified scope
Organization active roles are admin/consultant (UI: administrator/member); historical read enum stays compatible. Member UI has a single role column, without Skill reviewer controls/API reads. Last-admin and tenant guards retained. General/organization invitations already provide no-review mail/link behavior; new workshop mail preserves shared-token workshop membership semantics.

## Validation
Frontend47, contracts4, role-management DB16, migration/activation DB8, workshop HTTP/PG2+unit4+frontend2 passed. Integrated checks/review/CI must be checked live on the issue PR; dated progress is not current gate authority.

Blueprint P1: live POST /blueprints/:blueprintId/apply now authorizes admin, denying member/retired roles. Final HTTP/PG+policy8 passed, failed legacy-negative fixtures corrected and20 passed on retry; other47 TPL files passed in the initial run. See progress for the retained initial failures. Do not trust the removed stale comment that claimed this route was unregistered.

## Boundaries
No production migration or external inbox receipt tested. Email transport capture proves send invocation, not delivery/exactly-once; explicit retries may send again. Workshop tokens remain shareable and require existing org login. Historical organization role reads remain valid but no new lead/compliance assignment is accepted. Legacy memberships become ordinary members; existing project membership roles stay intact. The DB write fence intentionally rejects old applications assigning legacy roles after migration; a release rollback must account for this schema boundary. Internal Skill review workflow policies/APIs are not disabled by removing their member-list UI.

## Next steps
Run `pnpm harness pr-queue --pr <issue-linked PR> --json` for its current exact SHA. Complete required CI, resolve findings, and use the authorized release lane before claiming CN repaired. Preserve expiry/revocation/email-identity checks; no admin reapproval stage is added. Own test-isolation stacks are cleaned by the wrapper. Reuse this session's existing worktree; do not create a second one.
