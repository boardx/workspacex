# R9 service actor persistence proposal (approval required)

Issue: #4256

Status: **design draft; not an executable migration**

Decision owner: human security / database owner

## Why this is gated

Service actor credentials are authorization material. Adding their lifecycle changes the PostgreSQL security boundary: new credential digests become readable by some role, lifecycle rows become writable, and tenant RLS must cover every access path. The application contract and in-memory unit boundary can be reviewed without making that change, so the production adapter, controller registration and migration remain intentionally absent.

An automatic approval review rejected an executable migration because the requested `app_rw` and RLS changes had not been explicitly authorized. This document records the proposed blast radius for an informed decision; it does not bypass that review.

## Approved behavior target

- Only a current Board owner creates, lists or revokes actors.
- A credential binds `org_id + board_id + actor_id + delegated_by + scopes`.
- A raw credential is returned exactly once and never stored.
- Persist only `sha256(raw_credential)` plus a display-safe prefix.
- A service call also requires the delegating human's current session. The actor credential cannot expand human access.
- Revoked and expired credentials fail as `401` without revealing which condition matched.
- Lifecycle events are append-only and contain no raw credential or digest.
- Actor create/revoke and its audit event commit atomically.

## Proposed schema

The future migration would create two tenant tables. Names and columns are proposed for review:

```sql
CREATE TABLE whiteboard_service_actors (
  org_id text NOT NULL,
  board_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 120),
  delegated_by text NOT NULL,
  scopes text[] NOT NULL,
  credential_digest text NOT NULL CHECK (credential_digest ~ '^[a-f0-9]{64}$'),
  credential_prefix text NOT NULL CHECK (credential_prefix ~ '^wsxb_[A-Za-z0-9_-]{8}$'),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoked_by text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (org_id, board_id, actor_id),
  UNIQUE (org_id, credential_digest),
  FOREIGN KEY (org_id, board_id) REFERENCES whiteboards(org_id, id) ON DELETE CASCADE,
  CHECK (expires_at > created_at),
  CHECK (revoked_at IS NULL OR revoked_at >= created_at),
  CHECK (scopes <@ ARRAY['board:read','board:write','board:present','artifact:read']::text[]),
  CHECK (scopes @> ARRAY['board:read']::text[])
);

CREATE TABLE whiteboard_actor_lifecycle_events (
  org_id text NOT NULL,
  board_id uuid NOT NULL,
  event_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  event_kind text NOT NULL CHECK (event_kind IN ('ServiceActorCreated','ServiceActorRevoked')),
  delegated_by text NOT NULL,
  scopes text[] NOT NULL,
  occurred_at timestamptz NOT NULL,
  PRIMARY KEY (org_id, board_id, event_id),
  FOREIGN KEY (org_id, board_id, actor_id)
    REFERENCES whiteboard_service_actors(org_id, board_id, actor_id) ON DELETE CASCADE
);
```

Indexes proposed for the credential hot path and owner list view:

```sql
CREATE UNIQUE INDEX whiteboard_service_actors_active_digest
  ON whiteboard_service_actors(org_id, credential_digest)
  WHERE revoked_at IS NULL;

CREATE INDEX whiteboard_service_actors_board_created
  ON whiteboard_service_actors(org_id, board_id, created_at DESC);
```

The full unique constraint and partial index are intentionally redundant in the first draft. Security review should choose one global uniqueness invariant; the recommended choice is the full unique constraint so a revoked credential can never be inserted again.

## Tenant RLS proposal

Both tables would have RLS and `FORCE ROW LEVEL SECURITY`, with fail-closed tenant policies based on the existing transaction-local organization context:

```sql
ALTER TABLE whiteboard_service_actors ENABLE ROW LEVEL SECURITY;
ALTER TABLE whiteboard_service_actors FORCE ROW LEVEL SECURITY;
CREATE POLICY whiteboard_service_actors_tenant ON whiteboard_service_actors
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

ALTER TABLE whiteboard_actor_lifecycle_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE whiteboard_actor_lifecycle_events FORCE ROW LEVEL SECURITY;
CREATE POLICY whiteboard_actor_lifecycle_events_tenant ON whiteboard_actor_lifecycle_events
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));
```

The migration must also call `kernel_apply_org_freeze_policies()` after table creation so an organization freeze blocks lifecycle writes consistently with other tenant data.

## `app_rw` decision required

Recommended minimum for the current repository design:

| Table | Proposed `app_rw` grants | Reason |
| --- | --- | --- |
| `whiteboard_service_actors` | `SELECT, INSERT, UPDATE` | resolve/list, create, revoke; no hard delete |
| `whiteboard_actor_lifecycle_events` | `SELECT, INSERT` | audit append/read; no update/delete |

No `DELETE` is proposed for either table. Board deletion uses the existing foreign-key cascade under the Board lifecycle path.

Tenant RLS prevents cross-organization access, but it does not enforce Board ownership inside an organization. The application service checks owner access and the production repository must repeat an owner predicate in each create/list/revoke statement. This still leaves `app_rw` capable of tenant-local lifecycle mutation if arbitrary SQL execution is obtained.

Security must explicitly choose one of these before activation:

1. **Approve direct `app_rw` DML (current recommendation for consistency).** Accept tenant-local blast radius, require repository owner predicates, query parameterization, no generic SQL exposure and audit invariants.
2. **Use a narrower database role.** Add a second `DatabasePort` credential with only the grants above. This reduces blast radius but adds secret/configuration/deployment work.
3. **Use reviewed database functions.** Revoke table DML and grant only `EXECUTE` on narrowly scoped lifecycle functions. This is strongest at the DB boundary, but any `SECURITY DEFINER` implementation needs a separate search-path, ownership and injection review.

No option is silently selected by this change set.

## Proposed production repository invariants

- Create is a single CTE: `INSERT … SELECT` from the unarchived Board where `owner_id = delegated_by`, followed by audit insert in the same statement/transaction.
- List joins the Board and requires `owner_id = current human user`.
- Revoke is an update with `revoked_at IS NULL`, owner predicate and audit insert in the same statement/transaction.
- Credential resolution compares the SHA-256 digest under tenant context and requires exact Board, delegator, `revoked_at IS NULL` and `expires_at > clock_timestamp()`.
- Credential resolution returns only actor binding fields; never the digest or prefix.
- SQL logs and error attributes must not include the request header or digest.

## Activation sequence after approval

1. Add the reviewed migration and migration guard tests.
2. Add the PostgreSQL `WhiteboardActorRepository` adapter.
3. Register `WhiteboardServiceActorController` and its provider in `KernelModule`.
4. Run no-Docker unit/contract tests.
5. Run isolated-DB migration and RLS counterproofs.
6. Run the public producer, which provisions and revokes actors only through HTTP lifecycle routes.
7. Verify logs contain neither raw `wsxb_` credentials nor credential digests.

Rollback must unregister the controller first. The database rollback should revoke new grants before dropping policies/tables; live credentials become unusable as soon as the controller/provider is removed.

## Explicit approval statement requested

Approval should state all three items:

> Approve digest-only Board service actor credentials, tenant RLS on the two proposed tables, and `app_rw` grants of SELECT/INSERT/UPDATE on actors plus SELECT/INSERT on lifecycle events. No DELETE and no SECURITY DEFINER functions in this iteration.

Any narrower choice should name the selected database-role or function boundary before implementation.
