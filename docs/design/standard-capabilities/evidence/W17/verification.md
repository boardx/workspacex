# W17 verification ledger

## Executed

- Standard wrapper: `pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter @repo/api exec vitest run tests/agent-runtime/standard-sql-database.test.ts tests/agent-runtime/standard-sql-source-real-db.test.ts tests/agent-runtime/standard-memory-real-db.test.ts`: 3 files, 6 tests passed. Full output: `sql-http-tls-memory-regression.txt`. Includes two nested Python database tests and real official ToolNode calls over HTTP into a separate TLS PostgreSQL source. Wrapper cleaned its stack.
- `pnpm --filter @repo/contracts exec vitest run tests/standard-sql.test.ts`: 3 passed (generated schema/native manifest equality, hidden identity/DSN arguments, TLS-only configuration).
- `.venv/bin/python -m pytest tests/test_standard_sql_contract.py -q`: 3 passed (official metadata, unknown upstream version/source refuses before engine creation and releases slot); output `python-contract.txt`.
- `.venv/bin/python scripts/generate_standard_sql_tools.py --check`: exit 0. Upstream emits its genuine deprecation warning; this is not suppressed.
- `node --test apps/api/scripts/tests/standard-tool-run-boundary.test.mjs`: 13 passed, including removal of message-to-run thread binding counterexample; output `same-thread-boundary.txt`.
- `node apps/api/scripts/lint-permission-paths.mjs`: passed, 1288 files, 201 tenant tables, unchanged 91 allowlisted paths; output `permission-lint.txt`.

## Final database revision

`pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter @repo/api exec vitest run tests/agent-runtime/standard-sql-database.test.ts`: 1 API test passed, requiring all 3 nested Python tests to pass; 12.06 seconds. Full output `sql-cancel-timeout-final.txt`. This covers the final source, including unconditional slot release and full JSON serialized output bound.

Cancellation waits until actual PgSleep is visible in pg_stat_activity, then cancels and proves the connection has disappeared before returning. A separate real statement timeout closes its connection. Direct dedicated-role UPDATE/DELETE/CREATE attempts bypass the application grammar and fail with database InsufficientPrivilege. Unicode expansion exceeding the final serialized output cap fails explicitly. The wrapper cleaned its owned stack; no W17 resources remain running.

API typecheck at the earlier run found no SQL diagnostics, but was not globally green: five diagnostics were in concurrently edited native-full-chain and standard-platform-packs tests, reported to their owners. Do not misread this as a passing whole-project typecheck. Root owns the final shared integration validation and commit.
