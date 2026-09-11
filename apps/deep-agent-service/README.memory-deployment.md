# Native memory deployment

The Native graph always registers `wx_memory_search`, `wx_memory_write` and `wx_memory_delete`. Agent Server persistence (`DATABASE_URI`) does not configure this store. The memory service needs its own prepared database and identities.

| Variable | Prepare job | Agent / readiness job |
|---|---|---|
| `MEMORY_STORE_DATABASE_URL` | Required restricted memory runtime identity | Required |
| `MEMORY_STORE_MIGRATION_DATABASE_URL` | Required separate schema owner | Must not be provided to the permanent Agent |
| `MEMORY_STORE_SCHEMA` | Defaults to `workspacex_memory` | Same schema |
| `PROVISION_TIMEOUT_MS` | Required by the deployment CLI, 1–300000 | Required by readiness CLI |
| `DATABASE_URI` | When present, rejects reuse of Agent Server database/user | Agent Server's own independent database |

Starter prepares `memory_owner`, `memory_rw` and `workspacex_memory` using stable generated credentials. Production prepares equivalent separate identities and database before provision. Production DSNs must use verified TLS and refer to certificates actually mounted in the job/Agent container; host-only certificate paths are insufficient. The deployment driver owns those mounts and TLS validation.

Execute these commands in the release Agent image, with secrets supplied through its private environment file:

```sh
python -m deep_agent_service.memory_deployment prepare
python -m deep_agent_service.memory_deployment readiness
```

Prepare verifies that both identities reach the same database and that the runtime role is not an owner, member of another role, superuser, replication user, bypass-RLS user or role/database creator. It serializes official `PostgresStore.setup()` with a session advisory lock, since upstream migrations include concurrent index creation. It grants only schema `USAGE` and `SELECT/INSERT/UPDATE/DELETE` on the literal-memory `store` table. The migration history remains owner-only. No vector extension or embedding model is needed for the existing literal-search contract.

Readiness rechecks privilege boundaries and actually creates, updates, reads, searches and deletes a unique marker within one database transaction. This namespace is separate from user memory; it never invents a user-approved note. Runtime queries still use the existing trusted org/user namespace and API source-proof checks. A successful storage readiness check does not substitute for real model/tool approval or cloud acceptance.

Both commands emit only safe status fields. They accept no passwords on argv and suppress underlying libpq errors that could include connection details. The outer provision driver must still own and cancel the helper container on deadline, and retain its lock if remote cleanup cannot be proven.

The PostgreSQL lane in `tests/test_memory_deployment.py` creates and removes uniquely named databases/roles under an explicitly supplied `WX_MEMORY_TEST_DSN`. It verifies preparation replay, actual registered-tool read/write/delete, fresh-connection recall, org/user separation, rejected privilege escalation and safe CLI failure, and deadline cancellation of a real advisory-lock wait with no later DDL. The source-proof callback is supplied by the fixture in that lane; the existing `apps/api/tests/agent-runtime/standard-memory-real-db.test.ts` separately runs the actual HTTP proof + Python ToolNode + PostgreSQL chain.
