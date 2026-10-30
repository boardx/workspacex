# Verified develop promotion — #6040

User-approved design: develop performs full validation once. Pure same-repository develop-to-main/main-us promotion reuses that exact validated content, while changes/conflicts execute full validation and unavailable evidence for an identified pure promotion blocks admission. Environment-specific deployment admission, migration, health and smoke remain separate.

1. Restore named API test scripts for billing-provider and self-usage configurations; run config reachability and both suites. Add reachability to pre-merge control-plane validation.
2. Add fail-closed promotion identity and evidence policy tests. Require source/head/synthetic merge tree equality, trusted base policy unchanged, latest develop push/current attempt success, both independent workflows and retained artifacts. Failed, pending, missing, skipped, cancelled, expired or ambiguous evidence never authorizes reuse.
3. Add bounded read-only GitHub lookup/CLI and trusted-base workflow admission. The candidate cannot authorize itself. First installation/policy change runs full validation.
4. Preserve required job names and actual successful steps on reuse; non-required heavy jobs may be omitted only with verified authorization. Ordinary feature PRs, develop integration and changed promotion trees keep original validation. Keep merge metadata and environment deployment checks.
5. Test identity/evidence counterexamples, workflow wiring, old gate regression tests and API entrypoints. Create develop PR automatically, respond to review and follow required CI. Do not declare runtime release complete from branch synchronization.

Implementation responsibilities: main session owns API manifest/docs/evidence; worker promotion_lookup owns bounded CLI/tests; worker promotion_workflows owns workflows/tests. Shared checkout, no extra worktree. All work targets develop first.
