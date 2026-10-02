# R09 Real File Acceptance

Status: prepared, not executed. Acceptance increment is tracked by issue #5032.
Its branch starts from parent navigation PR #4993 at
`1e1eb5d5d3219388d6d1472192fcb1ac3688fbcd`; this is a source baseline,
not a claim of current remote state or runtime verification. Merged PR #5006
alone does not prove main delivery.

## Runtime Preconditions

- Use an existing isolated API/Web/PostgreSQL/objectstore runtime with the normal fullstack identities seeded.
- Set `BOARD_FILES_WEB_URL`, `WORKSPACEX_API_PORT`, `WORKSPACEX_ISOLATION_ID`, `WORKSPACEX_DB`, and the usual app DB connection variables for that exact runtime.
- `WORKSPACEX_DB=workspacex` is rejected. Every DB probe checks real `app_rw`, non-superuser/non-bypass, non-table-owner identity and enabled/forced production RLS.
- The config has no `webServer`, infrastructure setup, Docker command, DB reset, or migration hook.
- Runtime source manifest and served JavaScript chunks must match the candidate source SHA before and after the run. A stale runtime is a failure, not accepted evidence.
- Existing fullstack fixture accounts must not concurrently log in elsewhere during this lane, because device/session revocation is real.

```bash
pnpm exec playwright test --config=e2e/board-files-existing-runtime.config.ts
```

Run from `apps/web`, after the coordinator grants runtime access. Do not run this command as test preparation.

## Acceptance Matrix

| Item | Required observable evidence |
| --- | --- |
| F01 Local ordinary-file drop | Browser File/DataTransfer with a synthetic DOM drop exercises the actual editor event/upload path, sends genuine multipart HTTP, creates exactly one visible file tile, and returns durable metadata matching source bytes. This is protocol/UI integration, not an operating-system drag gesture. No API-seeded tile substitutes for the drop. |
| F01 Filename fidelity | A Chinese filename containing spaces and literal double quotes survives browser upload, stored metadata, refreshed tile title, RFC5987 attachment header, and browser suggested download filename. |
| F01 Legacy compatibility | A separate upload with distinct bytes omits multipart fileName; its UTF-8 Chinese filename remains exact. Distinct bytes prevent deduplication from hiding legacy decoding failures. |
| F01 Metadata first-write identity | Reuploading identical bytes under another filename returns the first stored metadata exactly; no extra database asset is created. |
| F01 Multipart rejection | Empty filename, unknown field, and duplicate filename parts yield actual HTTP 400 and create no stored asset rows. Handcrafted MIME is sent to the running Nest/Multer server, not directly to a controller method. |
| F02 Durable state | The actual app-role database contains two active assets with the exact metadata. Reload retains the dropped tile and downloading from actual UI produces byte-for-byte identical content, not just a successful status code. |
| F02 HTTP byte safety | Authorized content is actual source bytes with application/octet-stream, nosniff, private/no-store, and exact RFC5987 filename. |
| F02 Role enforcement | A real viewer can download but cannot upload; a foreign tenant cannot upload; revoked viewer, foreign tenant, and another board cannot retrieve the asset. Denial does not mutate database rows or the canonical board head. |
| F02 RLS counterproof | SELECT without an org setting and with an actual foreign org yields zero rows under a checked app_rw/non-bypass role. Queries intentionally filter only by board so application-side org filtering cannot mask RLS failure. |
| F02 RLS WRITE counterproof | Same-tenant INSERT/UPDATE/DELETE each affects one row, proving valid input and actual write privileges. Foreign/null-tenant INSERT must raise SQLSTATE 42501; UPDATE/DELETE must affect zero rows. Every probe is independently savepoint-rolled-back, including unexpected success. |
| F02 Archive boundary | Actual HTTP upload after board archive returns 403/404 and durable asset rows remain unchanged. |
| F02 Frozen-org boundary | A separately created disposable tenant first successfully uploads, then its real organization lifecycle row is frozen. Same-tenant INSERT/UPDATE must raise 42501 and DELETE must affect zero rows. Actual HTTP upload returns 403/404, never an accepted 500, and asset rows are unchanged. |
| F03 Portability boundary | File-backed export, template, backup, and copy remain explicitly fail-closed until byte migration is supported. The existing focused F03 tests remain required; standard-export is deliberately not a persistence oracle for a file board. |

## Evidence And Remaining Gates

The lane writes `R09-file-refreshed.png` and private `R09-files-result.json`
with runtime identities, source SHA, actual metadata, DB rows, and denial status receipts.
It never writes bearer tokens or private downloaded bytes into the evidence JSON.
Temporary foreign-tenant identity and all created boards are cleaned up in finally;
the disposable tenant freeze is restored before its own board is archived and the tenant removed.
Lifecycle fixture setup uses the DB owner only for that exact disposable organization.
All data-permission probes execute as checked `app_rw`; the owner does not serve as a security oracle.

Before approval, run the prepared lane against the actual candidate and review its screenshot;
run focused F03 rejection tests; inspect the actual archive/frozen-org HTTP and RLS WRITE receipts.
These checks are prepared but have not connected to a database or run against a server.
Actual operating-system file dragging still needs a separate manual browser acceptance;
synthetic DOM dispatch is not evidence for that native interaction.
No screenshot, DB result, live browser pass, main delivery, or all-green CI is claimed yet.
