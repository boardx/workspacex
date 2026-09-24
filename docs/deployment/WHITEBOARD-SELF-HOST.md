# Board self-host deployment

This is the minimal open deployment lane for Board collaboration. It requires immutable
WorkspaceX API and Web images built from the same release, PostgreSQL 16 and Redis 7. It
does not require a hosted WorkspaceX service or an AI provider for sticky notes, drawing,
Yjs collaboration, history, import/export, or the public Board API/SDK.

## Install

1. Copy `deploy/whiteboard-selfhost/.env.example` to `.env` beside `compose.yaml` and replace
   every placeholder. Keep migration, application and diagnostics database credentials
   different. Do not commit `.env`.
2. Pin API and Web images by digest from one release. Verify their published provenance
   before starting them. The example does not assert that placeholder image names exist.
3. Run `docker compose --env-file .env -f compose.yaml config` and inspect the rendered
   configuration. Then run `docker compose --env-file .env -f compose.yaml up -d`.
4. Wait for `GET /readyz/whiteboard` to return HTTP 200. Its body reports only boolean
   database/session-store/validator states. Scrape `GET /metrics/whiteboard`; it contains
   aggregate low-cardinality metrics and never board, organization, user or content labels.
5. Open `http://HOST:8080/board`. Caddy forwards WebSocket upgrade requests on
   `/whiteboards/{id}/sync`; no separate WebSocket port is exposed.

The compose file binds only the proxy to the host. PostgreSQL and Redis remain on the
private network. For Internet use, terminate TLS at Caddy or an upstream proxy, restrict
the metrics endpoint to the monitoring network, and set production database/Redis TLS
according to your infrastructure. Do not expose PostgreSQL or Redis directly.

## Capacity and signals

The executable policy lives in `apps/api/src/domain/whiteboard-scale-policy.ts`.
The Board accepts at most 10,000 objects, 200 commands per atomic batch, 64 KiB per
Yjs update, 96 KiB per WebSocket frame, 50 connections per board, and 32 queued frames per
connection. Validator work is limited to four workers and 64 queued jobs/64 MiB. These are
admission limits, not performance claims. Raise them only after load evidence and memory
budgets are reviewed together.

Alert on readiness failure, persistence errors, validator queue growth, limit rejects,
reconnect spikes and update latency. Structured `whiteboard_sync` logs carry a trace ID and
bounded event/outcome/reason fields; they intentionally omit tenant and board identifiers.
`pnpm --filter @repo/whiteboard-core bench:scale` records a repeatable, pure-process 10,000
object fixture/load/read/viewport/selection/edit/sync/reconnect/memory run. Its guardrails
catch algorithmic regressions; they are not browser p95 or multi-user capacity claims.

## Failure drills

Run drills on a disposable copy of production-shaped data. The repository's whiteboard
validator tests reject oversized updates before persistence, and `scale-policy.test.ts`
pushes 10,000 synthetic admissions through a two-active/four-queued policy to prove excess
work is rejected without increasing those bounds.

For dependency recovery, keep one client connected, stop PostgreSQL, and confirm Board
writes receive no durable ACK while `/readyz/whiteboard` returns 503 and persistence error
metrics increase. Restart PostgreSQL, wait for readiness 200, reconnect, and compare the
semantic object set and durable sequence with the last ACK. Repeat with Redis and confirm
new authentication fails closed while existing board data remains in PostgreSQL.

The current store writes a full authoritative snapshot on every accepted update. It does
not yet run a destructive update-log compactor; the stable compaction counter therefore
stays zero. Add a compactor only with an idempotency-retention contract and a crash/recovery
drill. A zero counter is an explicit inactive state, not evidence that compaction succeeded.

## Backup and restore

Stop writes (maintenance page or proxy deny), then create a PostgreSQL custom-format dump:

```bash
docker compose --env-file .env -f compose.yaml exec -T postgres \
  pg_dump -U postgres -Fc "$PGDATABASE" > board-$(date +%F).dump
```

Encrypt the dump outside the stack and test restores regularly. Restore into a new empty
database, never over a running instance:

```bash
cat board-YYYY-MM-DD.dump | docker compose --env-file .env -f compose.yaml exec -T postgres \
  pg_restore -U postgres --clean --if-exists -d "$PGDATABASE"
```

Board text and Yjs snapshots live in PostgreSQL. Redis holds sessions; after a disaster
restore users may need to sign in again. Preserve any separately configured object-storage
backup when boards contain file/image objects.

## Upgrade and rollback

Back up first. Pull one tested release, update both image digests, run the one-shot migration
service, then replace API and Web. Check readiness and collaboration metrics before removing
the previous images. Database migrations must pass the repository's replay check before a
release is published.

Application rollback is changing both digests back. A release with a non-backward-compatible
database migration requires restoring the pre-upgrade dump into a new database and pointing
the old release at it. Never attempt to reverse schema changes by deleting migration rows.

## Open API and SDK

Automation uses the same tenant-scoped Board HTTP API and WebSocket protocol as the product.
See `packages/contracts/src/whiteboard.ts`, `packages/contracts/src/whiteboard-sync.ts`, and
the Board SDK package in the release. Use a narrowly scoped application identity; do not
share an organization administrator session token. Unsupported extension objects retain
bounded `extensionData`, allowing older clients to preserve content without executing it.
