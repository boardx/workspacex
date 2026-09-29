# Durable image acceptance producer

Run against an **already running, seeded, isolated fullstack stack** at the final
integration SHA. This config never starts Docker, services, or changes seed data.
Do not run concurrently with other specs logging in as the same fullstack admin
or lead accounts (device sessions may invalidate each other).

Required environment: `WORKSPACEX_ISOLATION_ID` matching seed-fullstack-smoke,
`WORKSPACEX_WEB_PORT` (or `WHITEBOARD_WEB_URL`), `WORKSPACEX_API_PORT` (or
`WHITEBOARD_API_URL`), and the isolated `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`,
`PGPASSWORD`. The producer resolves the API package’s already-installed `pg` driver through
`createRequire`; no psql executable or extra dependency is needed. The PG connection needs SELECT on board documents, updates,
image assets and asset refs. The producer opens a read-only transaction with the
fixture tenant context; it does not disable RLS or mutate storage.

From apps/web:

```sh
pnpm exec playwright test --config e2e/support/board-durable-images.config.ts --list
node --import tsx --test e2e/support/board-durable-images-storage.test.ts
# Only the coordinating session runs this against its isolated services:
pnpm exec playwright test --config e2e/support/board-durable-images.config.ts
```

The browser test uploads actual PNG bytes through the product file input, checks
its authenticated content response byte-for-byte, reads canonical objects through
the existing standard export API, verifies native image decoding and distinctive
pixels painted by Fabric, then repeats after reload and in an independent browser
context. Metadata evidence attaches source/target PG object pointers before source
deletion and target pointers afterward. Duplicate target content is read separately
both after source archive and permanent deletion. No raw ObjectStore URL is loaded
by the browser; object keys are only administrator-side storage evidence.

Revoked membership deliberately returns **404** to hide resource existence. The
spec checks exactly 404 for content and canonical export, no image response body,
removed canvas, URL revocation and failed subsequent blob fetch. This differs from
403 for forbidden mutations by a principal who can still read a board.

Passing the five producer unit tests and Playwright collection does **not** certify
browser, PG or ObjectStore runtime acceptance. The attached evidence is produced
only by the real run. Boards are created through the API and archived on cleanup;
the source is permanently deleted only after its duplicate has been verified.

## Fresh fullstack lane

For a fresh isolated run, use
`e2e/support/board-durable-images-fullstack.config.ts` instead. It inherits the
existing `playwright.fullstack-smoke.config.ts` API/web/seed orchestration and all
its required isolation environment variables. Run it through the repository’s
normal isolation wrapper with apps/web as cwd; do not start a parallel hand-built
stack. `--list` only collects; omitting `--list` starts the inherited fullstack
services, so actual execution belongs to the coordinating session.
