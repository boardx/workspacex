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

Root connection is now available through the user's existing Chrome Aliyun
Workbench Shell; confirmed uid=0/hostname/instance. Do not ask for credentials
again. Direct SSH from the workstation timed out before authentication. The
provided local key contents were not printed; it must remain private.

Read host-readonly.md before any mutation: all four app revision labels identify
f0eb9d07398a66fdd5646a9e6b855fa1b940e571 while checkout/main-cn is ba6343199.
Reconcile accepted runtime identity before preparing a baseline. The ordinary
release path still lacks an unattended producer for exact-source root cache and
prepared evidence. Existing candidate-config preparation and preflight collector
produce some real inputs, but not the complete /preparations/<SHA>.json. Do not
pre-fill passed gates or label a one-off root staging operation as automation.

3bc3f04bf contains independently reviewed Linux channel-fixture and three browser
regression fixes; targeted macOS/Linux and Chromium runs passed. New PR CI remains
pending. fixture-portability.md and interview-regression.md retain exact evidence
and resource cleanup. Preserve the same branch/worktree and continue #5912.
