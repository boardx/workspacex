# Interview Markdown persistence — issue #4382

## Scope

Task 2 of `docs/superpowers/plans/2026-09-27-interview-markdown-source.md`.
Reuses the existing worktree and artifact version table. No production data
changes, table deletion, permission grant changes, or automatic backfill in GET.

- Explicit tenant-transaction migration appends an immutable Markdown version.
- SHA-256 is computed over the exact UTF-8 body and checked when reading sources.
- Source reads return the existing permission-guarded envelope.
- Revision locking and expected-version checks reject stale writes.
- Migration is idempotent and retains legacy detailed fields, original Markdown,
  failed report status/partial text, and unconfirmed question drafts.
- Raw requirements stay in intake; research brief fields migrate to analysis.
- Upstream reconfirmation carries source hashes and controlled references into
  the new revision for inherited steps, without changing their document bodies.
- Legacy fields remain available for rollback. They are not deleted by this change.

## Verification

Commands run in an isolated test database, with resource cleanup by
`.harness/scripts/with-test-isolation.ts`:

```sh
pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter @repo/api exec vitest run tests/itv --maxWorkers=1 --minWorkers=1
pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter @repo/api migrate:check
pnpm --filter @repo/api typecheck
pnpm --filter @repo/api lint
```

The interview regression before the final archive-preservation fix passed
69 files / 494 tests. Empty-database migration and migration replay passed.
Permission/architecture lint passed. Focused tests first demonstrated the missing
source module, incorrect failed-report promotion, unchecked source corruption,
loss of detailed brief fields, and omitted draft question candidates.
Final focused regression passed 3 files / 21 tests, including all 8 source tests.
API typecheck passed after the final changes. The latest SHA is recorded in the PR.
Post-main full regression initially timed out twice in HTTP setup; isolated
setup rerun passed 8/8 without modifying assertions or timeouts. The next full
run passed those HTTP cases but caught the newly added analysis regression,
before its fix. Final review-fix results are recorded in the PR, not inferred
from these intermediate runs.

Review regressions: analysis/intake separation and inherited hash/reference
preservation each failed before the fix; combined source + LangGraph regression
then passed 2 files / 23 tests. API typecheck passed on these fixes.

Historical migration tests now wrap replay in BEGIN/ROLLBACK: replaying an old
schema must not restore obsolete constraints for subsequent fixtures.

## Not yet delivered

This is persistence groundwork, **not** a claim that the entire live interview
workflow now uses Markdown authority. Model/API consumer switching, prototype UI
completion, real-model/browser validation, and the full rollout are Tasks 3–7.
No synthetic model or browser result is presented as live production evidence.
