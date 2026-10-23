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

Latest continuation: source increment 1d0b94937 is pushed and all 55 reported PR
checks are green/neutral/skipped. Further producer/baseline/schema/direct-snapshot
changes are in the shared worktree, still being finalized and independently
reviewed. Consult current git status, not this note, before staging. Root policy
and matching trusted tools are not installed. main-cn/ruleset remain unchanged.

The current user-opened Workbench tab is usable when Mac is unlocked; the prior
forbidden browser result was not proof that ECS itself is inaccessible. The Mac
subsequently locked and an async unlock request is pending. Direct SSH and the
existing configured US jump route both timed out; do not print or ask for the key
again. No production files, database rows or runtime state have been changed.

Actual baseline is a three-file Compose stack with legacy directory suffixes.
New cn_compose_baseline.py must be installed alongside the three callers
(deploy, collect preflight, verify promotion) to keep the same fingerprint bytes.
Do not install only one caller. Published manifest mode0640 requires the new
root600 byte-preserving request-bound copy for strict private consumers.

The new direct-host snapshot protocol is version3 with original provider/audit/
ledger bytes; it does not impersonate CloudAssistant v2. All original migration
risk, out-of-order and drift gates remain. Current 16 SQL changes need a separate
exact migration review/maintenance path, not merely the new HTTP probe.

Latest verification/review: source endpoint binding, fixed host-network readonly
snapshot, outer cancellation, renderer starter profile, root-only tool tree,
resource headroom, and collector owner cleanup are now independently accepted.
Snapshot 16 tests; composition 70 pass/2 Linux skips; subsequent delta24 pass;
Python29/1 opt-in skip plus separate real Docker9; Node23; cloud-deploy tsc green.
The Docker cancellation fixture additionally proves a network-none bootstrap
container with the same owner is reclaimed independently. New tools image is
reviewed but not built; no installed image/policy identity may be fabricated.

Do not merge or report automatic production ready yet: fresh signed Devapp and
governance evidence still lacks an unattended producer, and main release SHAs
currently cannot use the develop-only Devapp deployment job. Review existing
backend-gates and controlled-evidence contracts before expanding that path.
User-visible root Workbench is connected, but current native inputs produce no
output; manual id-u verification request is pending. No host mutation.
