# CN image Agent attachment repair (#6319)

Original CN run `03259250-39bd-43eb-a5fd-42eeb631d2c2` succeeded but its
temporary provider URL failed in the test browser with `ERR_NAME_NOT_RESOLVED`;
refresh still produced zero natural image dimensions. This is evidence about
that browser/request, not a conclusion about every CN user's DNS.

The production ModelCallPort registered for `bailian-image` previously wrote a
provider URL directly into Markdown. The new adapter uses the existing guarded
downloader, bounds bytes/dimensions, decodes pixels, stores immutable bytes and
verifies readback before returning `RunOutputFile` references. The executor
preserves these through its existing message-attachment writeback. Failures do
not return a temporary URL or regenerate a paid image. Native request admission
and billing still belong to the underlying Bailian adapter.

Local evidence (base `33f3bd0313dcfef86a9240e93dbb203bdee3a76b` plus patch):

- Image lane: `pnpm --filter @repo/api exec vitest run --config vitest.image.config.ts`,
  13 files / 112 tests passed.
- Added actual-filesystem/pixel tests: ownership/cancellation before generation,
  durable readback, lost readback, download failure, invalid format and a PNG
  with valid signature but corrupt CRC. Final targeted rerun: 3/3 passed.
- Isolated executor/PG attachment regression:
  `pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter @repo/api exec vitest run tests/agent-runtime/execute-run-progress.test.ts tests/agent-runtime/agui-file-events-real-db.test.ts`,
  38/38 passed, database `wsx_7f7e39008e6033b47dc3`.
- Full API lint passed. API typecheck recorded separately in PR validation.
- Initial CI shard5 caught the existing executor line-count gate (1395 vs1393).
  Provider script/file outputs were then kept in one completion snapshot instead
  of parallel state variables, without changing the size gate or its assertions.

The image tests inject deterministic supplier output and download ports; they
do not call the paid CN supplier. PostgreSQL coverage verifies existing
attachment-event projection, not a browser image or a real-model conversation.
The first PNG fixture failed actual CRC decoding and was replaced with a valid
fixture; corrupt-image rejection remains an explicit negative test.

No CN release has been performed. After authorized deployment, generate a new
image in CN, inspect actual nonzero natural dimensions and refresh recovery,
and verify unauthorized/cross-thread download denial. Existing historical
temporary URLs are not retroactively archived by this change. Single Skill,
PDF downloads and seven-role acceptance remain separate regression obligations.
