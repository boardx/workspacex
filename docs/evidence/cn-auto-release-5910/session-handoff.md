# Issue #5910 handoff

Branch: codex/develop-cn-release-5910, same original worktree. Do not create another
worktree. Current scope includes the user's no-approval automatic deployment
request; keep main-cn desired state separate from accepted runtime evidence.

Read progress.md and docs/superpowers/plans/2026-10-24-cn-auto-release.md. The push
job only queues preparation; its green status is not acceptance. prepare dispatches
promotion only after a frozen tag is produced by the existing complete verifier.
branch-push promotion must activate even if the desired ref already equals source;
it rechecks for supersession before switching traffic. Preserve machine gates.

The removed reviewer is already live in GitHub. Do not reinstall it while retrying.
main-cn's old required-deployment rule must be removed only with reviewed code in
place; preserve deletion/non-fast-forward rules. Do not force refs or fabricate
Deployment success. New root helpers/configuration must be separately inspected
rather than assuming a local repository file is installed in production.

No production runtime changes have been made by this session so far. Production
still needs a real readiness check. Do not close #5910 merely because CI is green.
