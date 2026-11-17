# Pure human project member channel — B implementation

Implements the B portion of the user-approved collaboration proposal frozen at
`docs/design/aidt-member-collaboration/review.md`, SHA-256
`33b1c4e981a2b3dcea248f7b0f9b84c40b7afb76e61c63afa62e3f1368679c21`.
This evidence does not change any design-signoff status.

## Enablement and isolation

- `ENABLE_PROJECT_MEMBER_CHAT=1` or `true` explicitly enables the new API; every other value, including unset, disables it.
- Teaching frontend `NEXT_PUBLIC_ENABLE_AIDT` and skill installation `ENABLE_AIDT_MODULE` remain separate existing opt-ins. They do not enable the member channel by implication.
- Reuses the original API process, PostgreSQL database and project identity resolution. No communication server, AI thread, AgentRun, model call, voice room or external publishing is introduced.
- No existing Chat endpoint or project role matrix is changed. Only actual project members can use this channel; the existing general-project overview read fallback for organization managers does not grant channel access.
- Read/write and retries each recheck org/project ACL. Actual member rows, project and organization lifecycle rows are locked inside the tenant transaction; a second canonical ACL read catches a role change committed before the locks. Existing `content.renameFile` authorization supplies the project content-write tier without a second role matrix (matching stage-service authoring).
- New message rows are append-only through this API. Their database grant is SELECT/INSERT; channel counter grants additionally permit UPDATE. FORCE RLS, tenant policies, original org-freeze installer and project-archive installer cover both new tables. Direct project foreign keys intentionally satisfy the original archive installer's single-column discovery rule; composite keys also retain org/project integrity.

## Transport and durability

Contracts live only in `packages/contracts/src/project-member-chat.ts`.

- `GET /projects/:projectId/member-chat/messages`: initial/backwards history contains roots; forward `afterSequence` returns all newly persisted messages, including replies, and changed topic summaries.
- `POST` at the same path: server identity/time/sequence, stable caller UUID `clientMessageId`, plain text, optional root/stage reference. A reply uses the same POST with `threadRootId`.
- `GET /projects/:projectId/member-chat/messages/:threadRootId/replies`: root plus paginated replies, with current write capability.
- Single-level topics only. Root lookup always includes current org/project; a foreign/missing root is 404, a nested reply root is 422. Optional stage revisions must exist in this project's stage/revision table.
- The transaction locks the project channel counter before allocating/inserting. Counter changes and message insertion commit atomically, preventing an incremental cursor from skipping an earlier in-flight commit.
- `(org,project,author,clientMessageId)` is unique. Same normalized text/root/stage retries return the original message; changed content returns 409. Retry authorization occurs before reading this receipt.
- `nextAfterSequence`, not the maximum displayed root sequence, is the safe watermark after applying a page. It is the last row when more forward rows remain, otherwise the captured channel watermark. Summaries and rows are bounded by that watermark.
- Persistence acknowledgement is not delivery or read receipt. Frontend polling is the approved 5-second foreground incremental transport; real-time push, unread/mentions/notifications and voice are outside B.

## Error boundary

401 is supplied by the existing global auth guard (and checked by the adapter). Missing/invisible/cross-org/member-removed resources share 404. Existing members with observer role, archived project or disabled org receive distinct 403 readonly codes. Invalid input and nested root are 422, excessive text 413, changed idempotent retry 409, dependencies 503. The controller emits only the contract's closed `reasonCode`, never raw errors, SQL or stack traces. Global exception-filter registration is integrated by the root agent.

## Verification evidence

- `pnpm --filter @repo/api exec vitest run --config vitest.project-member-chat.config.ts` — **26 tests, 2 files passed**. `/tmp/aidt-member-chat-unit.log`.
- `pnpm --filter @repo/api typecheck` — **exit 0** for the first complete contract/controller/service/repository implementation. `/tmp/aidt-member-chat-tsc.log`. A subsequent run including new shared tests reported three errors outside B (`tests/aidt-stages/shared-stage-unit.test.ts:57,58` and `tests/logging/aidt-collaboration-errors.test.ts:9`); owners were notified and the integrated check must be rerun after their fixes. `/tmp/aidt-member-chat-final-tsc.log`.
- `node .harness/scripts/lint-arch-deps.mjs apps/api/src` — passed (2,294 files at time of run).
- `node apps/api/scripts/lint-permission-paths.mjs` — passed (2,299 files / 338 derived tenant tables at time of run).

The unit lane uses fake ports and the canonical permission decision code. It does not connect to PostgreSQL or an HTTP server, prove simultaneous-browser communication, or establish delivery/read latency. The compatibility-test agent owns actual isolated PG/HTTP evidence, including concurrent sequences, idempotent lost-response retry, removed/foreign members, old-topic delta visibility and no new model/AgentRun rows.

## Registration checklist for composition root

- Export `projectMemberChat` namespace from contract barrel if root contract discovery requires it; frontend can use the public subpath directly.
- Register `ProjectMemberChatController`.
- Register `PROJECT_MEMBER_CHAT_REPOSITORY` with `new PgProjectMemberChatRepository(db)` injected from the original `DATABASE_PORT`.
- Add the contract `Reason` closed enum to the existing global exception filter's reason-code allowlist.
- Apply `20261115093000_project_member_chat.sql` only in the authorized isolated environment; no production migration has been run by this worker.
