# Board content online rollout

The Board migration command has two deliberately separate levels:

- `--board-id` advances one Board by a bounded number of durable phases.
- `--rollout` discovers and advances an organization fleet through a durable,
  tenant-scoped rollout journal.

Neither form contains an unbounded loop. A busy Board that repeatedly changes its
watermark consumes the configured phase/retry budget, records a sanitized error and
waits for exponential backoff. It never becomes a tight loop that repeatedly reads
the full legacy body or publishes fresh AES-GCM candidates.

## Preview

```bash
pnpm --filter @repo/api board:migrate-content -- \
  --rollout --dry-run \
  --rollout-id 0199aabb-ccdd-7eef-8abc-012345678900 \
  --tenant-id org-a \
  --page-size 100 --max-pages 2
```

Dry-run only performs stable, ordered PostgreSQL reads. It does not create a rollout
row, work item, migration journal, object or encryption/KMS client. The result reports
the bounded Board IDs and the full remaining legacy population.

## Execute and resume

```bash
pnpm --filter @repo/api board:migrate-content -- \
  --rollout \
  --rollout-id 0199aabb-ccdd-7eef-8abc-012345678900 \
  --tenant-id org-a --tenant-id org-b \
  --page-size 100 --max-pages 1 --max-boards 100 \
  --global-concurrency 4 --tenant-concurrency 2 --rate-per-second 4 \
  --phase-budget 3 --retry-budget 5 \
  --base-backoff-ms 1000 --max-backoff-ms 60000 --lease-ms 60000
```

Re-run the identical command to resume. Each tenant persists a stable UUID cursor;
discovered Boards become durable work items before the cursor advances. A worker
claims with `FOR UPDATE SKIP LOCKED` and a lease. Expired leases return to retry, so a
process crash cannot skip the Board. Job configuration is immutable for the rollout ID;
changing pressure limits requires a new rollout ID.

The runner schedules tenants round-robin, enforces global and per-tenant concurrency,
and spaces launches by the requested rate. The repository also rechecks the persisted
control state at claim and before every Board phase. Each invocation is bounded by
pages, Boards, phases and retries.

## Pause, resume and cancel

```bash
pnpm --filter @repo/api board:migrate-content -- --rollout \
  --rollout-id 0199aabb-ccdd-7eef-8abc-012345678900 \
  --tenant-id org-a --control pause

pnpm --filter @repo/api board:migrate-content -- --rollout \
  --rollout-id 0199aabb-ccdd-7eef-8abc-012345678900 \
  --tenant-id org-a --control resume

pnpm --filter @repo/api board:migrate-content -- --rollout \
  --rollout-id 0199aabb-ccdd-7eef-8abc-012345678900 \
  --tenant-id org-a --control cancel
```

Pause and cancel are durable. A claimed worker re-reads control before each phase and
releases a paused item without consuming its attempt. Cancel marks all non-terminal
items cancelled. Every control and outcome appends a tenant-isolated audit event.

## Observable evidence

The structured snapshot reports unique Boards discovered/scanned/migrated/failed,
retry count, verified bytes read/written, watermark CAS resets, unreachable candidate
count, phase calls, aggregate latency, remaining legacy population, and the latest 50
sanitized Board errors. Content bytes, keys, ciphertext, manifest paths and exception
messages never enter the rollout report or audit event.

Storage and encryption are created only through
`createConfiguredBoardStorageRuntime`. Hosted object storage/KMS can replace that
composition seam without changing the fleet runner. Candidate orphan counts remain
explicit in rollout evidence and are the hand-off to the object inventory/GC provider;
production rollout remains gated on that provider being present and verified.
