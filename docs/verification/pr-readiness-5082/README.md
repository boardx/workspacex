# Frozen-organization file upload denial — #5082

CI in PRs #5075/#5076/#5077 receives HTTP 500 for a frozen organization upload. SQLSTATE 42501 is raised by whiteboard_file_assets_org_frozen_ins after Board role access passes. The policy correctly denies writes.

The PostgreSQL adapter now translates SQLSTATE 42501 into the existing FORBIDDEN domain error after withTenant completes rollback; the existing controller maps it to HTTP 403. Other database errors preserve identity. No schema, RLS, role, or API permission change.

## Validation

- init.sh: passed.
- RED: new denied-persistence HTTP regression failed before the fix; 1 failed, 28 passed (red.txt).
- File assets + multipart HTTP tests: 58 passed (focused.txt).
- API typecheck and lint: passed (typecheck.log, lint.txt).
- Independent read-only reviewer /root/review_frozen_files: ACCEPT, no actionable findings; independently ran 29 file-asset tests. Review covered the current two-file implementation diff; real PostgreSQL rollback and browser were outside that review evidence.
- Broader whiteboard suite: Node 22.14 first run had validator worker failures (18 failures, 755 passed). Node 22.23.2 removed those errors, but one undo worker test timed out and reason-code-response could not resolve work-eval because the existing root contracts alias also matches subpaths. Isolated undo retry passed all 14 tests; the exact-root alias diagnostic rerun passed 76 files / 775 tests (whiteboard-suite.txt). The temporary config changes only root-alias matching, retains the checked-in test selection/assertions/timeouts, and is saved as diagnostic-unit-config.mts. Real browser lane and CI are pending; the checked-in broad unit command still has its pre-existing alias limitation.

## Handoff

User explicitly authorized bypassing coordination identity/lease prerequisites for this PR remediation task. Maintain GitHub issue/PR evidence. Reuse this session worktree; do not create a second one. Do not automatically merge. Active owners handle #5080 test compatibility and #5077 report-review correction. #5070 was updated from main and #5073 cancellation rerun was requested.
