# R09 Ordinary File Upload Development Evidence

Issue: #4861. This is an uncommitted development candidate, not a passing feature,
merged delivery, database migration acceptance, or real-browser screenshot acceptance.

## Implemented Scope

- Separate ordinary-file drag/drop path; no image dialog for nonimages.
- Verified durable attachment metadata/bytes; download uses inert attachment headers.
- Optional multipart `fileName` uses the existing filename validator. Omission retains
  the existing lossless UTF-8/Latin1 fallback; explicit empty/duplicate/unknown/array/
  nested/file-typed fields are rejected before asset writes.
- Browser appends the unmodified `file.name` field. Same-board content dedup retains
  the first persisted filename and MIME rather than overwriting them.
- Independent ordinary-file AbortController; permission/user/board changes and
  unmount prevent late insertion. Failed upload has an explicit retry action.
- Protected asset metadata does not enter the generic structured field editor;
  downloads remain available to read-only viewers.
- Until file bytes can be copied safely, portable export, backups, and cross-board
  duplicate reject direct and template-nested file asset references explicitly.

## Executed Checks

```sh
pnpm --filter @repo/api exec vitest run --config vitest.whiteboard-unit.config.ts tests/whiteboard/file-assets.test.ts tests/whiteboard/file-multipart-http.test.ts tests/whiteboard/portable-board.test.ts tests/whiteboard/board-backup.test.ts tests/whiteboard/board-content-copy-objectstore.test.ts
pnpm --filter web exec vitest run tests/ui/board-file-drop.test.tsx tests/ui/board-file-upload.test.tsx tests/ui/board-contextual-toolbar.test.tsx --maxWorkers=1 --no-file-parallelism
pnpm --filter @repo/api lint
pnpm --filter @repo/api typecheck
pnpm --filter web lint
pnpm --filter web typecheck
```

- API: 91/91 pass, including 29 actual Nest/Multer loopback HTTP tests, 27
  application/repository tests, and 35 portability/backup/copy regressions.
  Loopback test server is closed in `afterAll`. Empty and 25MB+1 payloads are
  actually sent through Multer, yielding 400 and 413 with no asset writes.
- Web: 24/24 pass, including 4 transport/integrity/inspector tests, 4 editor
  drop/retry/permission lifecycle tests, and 16 existing contextual-menu regressions.
- API lint/typecheck and Web lint/typecheck: exit 0. All owned verification
  processes have completed; no test runtime is left running.
- Genuine RED then GREEN: Busboy raises `partsLimit` when the part count equals
  its limit. Limit 2 rejected all nine legitimate file-plus-filename cases; bounded
  limit 3 with `files: 1`, `fields: 1` accepts two parts and rejects all extras.
- A jsdom drag fixture initially lacked client coordinates. It now constructs the
  event explicitly instead of weakening successful tile creation assertions.
- Genuine RED then GREEN: direct file portable/backup/copy rejection tests initially
  all resolved successfully with unreadable assets (3 failed, 29 old tests passed).
  The five scoped guards fix these cases; nested-template variants also reject
  before verified archive or canonical target publication.

## Remaining Acceptance

Real database/RLS/org-freeze/archival policy execution, authentic sessions and access
revocation, production runtime HTTP, pan/zoom placement, refresh persistence,
503 retry/no duplicate tile, browser filename/download bytes, and desktop/mobile
screenshots are not proven by these unit and fixture-backed HTTP tests.

Portable/copy guards are development-tested; production HTTP/real-database evidence
and reconciliation with the separate R03 metadata worktree still belong to integration.
No Docker, persistent service, commit, push, PR creation, or merge was performed here.
