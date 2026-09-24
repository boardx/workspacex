# #3926 Board resource PostgreSQL acceptance

2026-09-24. Independent test: `apps/api/tests/whiteboard/resource-lifecycle.test.ts`.

## Scope

Six real PostgreSQL cases use shared database fixtures and PgDatabase, without mocking the repository:

- Concurrent idempotent create, one list entry, fresh pool readback.
- Private default against same-org nonmember; same user ID in a different organization cannot read/update/manage membership.
- Owner rename/archive/restore with persisted readback.
- Editor and viewer each may read but cannot update metadata, enumerate/manage membership, or archive.
- Only same-org members may receive grants; role changes are readable; revocation removes get/list access.

## Reproduction

```bash
COMPOSE_PROJECT_NAME=wsx-board-3926 PGPORT=55526 WORKSPACEX_DB=wsx_board_3926 pnpm --filter @repo/api exec vitest run tests/whiteboard/resource-lifecycle.test.ts
```

Cleanup after a successful infrastructure start must target only the owned project:

```bash
PGPORT=55526 docker compose -f apps/api/docker-compose.dev.yml -p wsx-board-3926 down
```

## Result: blocked before tests

Two automatic escalation approval reviews timed out before permitting execution. A sandbox execution then exited 1 in globalSetup:

```text
permission denied while trying to connect to the docker API at unix:///Users/shenyanbin/.docker/run/docker.sock
Test Files no tests
Tests no tests
```

No database test ran and no claim of passing is made. No owned Docker stack was started by these attempts. A pre-implementation red result was not captured: the initial command was held at automatic approval, and implementation appeared before execution became available. This is an environment block, not evidence of an implementation failure. Parent implementer was notified to rerun with authorized Docker access.

## Parent acceptance after environment access

2026-09-24: parent reran the isolated PostgreSQL suite after correcting fixture org_role to consultant (member is not a valid org role). 6/6 repository tests passed. Combined real HTTP + repository run: 11/11 passed, 2 files. API complete lint passed; web typecheck and lint passed; resource UI 5/5 component tests passed. No browser end-to-end claim yet.

Command: `COMPOSE_PROJECT_NAME=wsx-board-3926 PGPORT=55526 WORKSPACEX_DB=wsx_board_3926 pnpm --filter @repo/api exec vitest run tests/whiteboard/resource-http.test.ts tests/whiteboard/resource-lifecycle.test.ts`.
