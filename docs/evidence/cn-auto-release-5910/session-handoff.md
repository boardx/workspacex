# Issue #5910 handoff

Important later correction:5fb79c752 new CI failed3checks. The initial builder
used duplicate compiler settings and missed existing canonical generator. Current
repair rebuilds only through .harness/scripts/build-cn-maintenance-controller.cjs
and parity calls its --check; controller+migrator change (indirectfixed_transport
import), snapshot same. Historical sidecar test now reads immutableaa367861
fixture instead of current browser; production pins unchanged,16/16+10/10 and
alltool102/102 green. Actual frozenLinuxarm64 all3bundleparity and9cloudtests green.
Need commit/push and new full CI; read canonical-generator-ci-repair.md.

Devapp live facts now proven: exactDNS47.77.215.155 maps one running ECS us-west-1.
Existing CloudShell identity can run metadata-onlyroot there; originalresults
Success/0/dropped0. All4modules+installer present; installer hash matches current
source and supports4. Deploy/modulebytes stale; normalmain-only update required.
Existing signingkeyroot600 present and publicDERidentity matches CN existingkey,
through2 independently fetched actualAPIresults; no newkey/privatecopy/permission.
See devapp-trusted-files-live.md. Do not askuserforDevappkey ornewrootentry.

Latest checkpoint:611c442 CI finished30 success/19 skips/no failures. Necessary
canonical installer closure/modes/root compatibility follow-up is frozen and
independently accepted115 cases; owner102 tool tests and consumer/type checks
also pass. Read canonical-auto-tool-install-contract.md and
canonical-tool-upgrade-live.md before installation. Actual old tool SHA is
8d0ffff2da8a22e10a8494540c3085f486cdaf62 (40hex; earlier spelling missed one f).
No narrow25-file updater was installed. Do not fake the128-source old profile.

An already signed-in console Cloud Shell is usable and its existing identity
can invoke Cloud Assistant without a new credential/grant. A uid0/public-marker
probe returned real Success/0/dropped0 and exact scope/output; original bytes are
in ephemeralCloudShell ~/cn-tools-inventory-5913/channel-v3-{start,result}.json.
Use --InstanceId.1 for that CLI, not a JSON --InstanceId value. Its one-hour
session expires. The CN instance role STS works but Cloud Assistant read is denied.
Do not expand that role. Root-private official CLI3.5.2 staging is separate from
the existing uid1001-owned installed client. No installed entry was changed.

Outstanding actual installation/policy/Devapp identity and16migration rehearsal
remain. Do not mark automatic production ready, close5913, remove migration
guards or infer deployment from CI/tool tests. User withdrew governance broker
and App permission changes; never ask for App keys/MFA to restore that approach.

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

GitHub live correction: #5912 is MERGED (usersyj, 2026-10-23T18:30:31Z),
main d1096e300. Existing local branch merged that main as 6f75beff2 without a
new worktree. Follow-up issue #5913 tracks the still-unfinished actual automatic
preparation/release lane. Post-merge workflow/baseline tests21 pass/2 Linux skips.

Workbench root terminal recovered after user completed MFA; fresh readonly host
checks report uid0 and 42.9 GiB free. Existing governance signer/public key and
Devapp public verifier are root600. Automatic preparation policy is absent; root
GitHub CLI has no configured authentication. No trusted entries, policy, runtime,
production database or refs changed in this continuation. Existing boardx-coord
App has administration-write installation but its key/service and selected repo
membership are not proven. Current gateway documentation instead points to the
other coordinator App; never substitute its key or workstation token. Devapp
exact-source acceptance and governance signed-facts unattended producers remain
unfinished. The supplied workspace-cn PEM is SSH only, not GitHub App auth.

Later in this continuation the one-time shadow tools image was built successfully
from the same reviewed Dockerfile after the default Debian public mirror timed
out. See tools-image-live.md for the exact actual image ID, resource limits,
private mirror, independent executable checks, and cleanup. No canonical browser
preflight/candidate acceptance is claimed; installed root tools/policy remain
unchanged. CN gh is /usr/local/bin/gh, not /usr/bin/gh. This is not a Devapp fact.

The exact-source Devapp coordinator/root wrappers, governance broker/root HTTPS
client, and bounded signed-evidence staging are now implemented and independently
reviewed. Local integration checks: 48 pass/3 platform skips; actual Linux lock
counterexamples were separately exercised without skips by the owners/reviewer.
The Devapp reviewer found and required full backend gates at the root trust
boundary plus real cancellation child-group/temp cleanup; both were fixed.
Root governance FD9 proof also rejects an unlocked descriptor when another
process holds the same inode. New full PR CI for these additions is required.

Superseding user instruction: after approving a possible one-time App update,
the user explicitly chose "调整代码，移除发布治理校验". The entire unpublished broker
increment was withdrawn. Shared prepare/promotion now requires no governance
receipt or full-visibility ruleset/environment audit; it does not manufacture a
governance success result. No App permission change or Cloudflare deployment was
performed. Do not request GitHub reauthentication/App approval again for this
removed requirement. Native Deployment, actual CI/Devapp, backup/restore,
migration, immutable-tag byte binding and CAS remain separate release gates.
See release-governance-removal.md for this deliberately changed boundary.

Further superseding checkpoint: candidate-ci-wait.md records a separately
budgeted, read-only cloud wait for exact main CI, independently reviewed and
locally passing. Root default CI admission remains strict. CN public Git
ls-remote succeeded. A root-private mirror download is running at
/var/lib/workspacex-cn/auto-tools-source-staging-5913/source.git with a600-second
timeout, private download.log, and canonical release lock held by its Python
parent. Verify terminal exit, complete object state and source binding before
using it. No trusted software or policy installation occurred in this step.

Superseding live checkpoint: source download completed, fsck/no partial/alternates
passed; explicit local-bundle ref import produced clean exacta10afa5f5 standalone
reviewed-checkout. Frozen offline dependencies and tsx passed after separate
locked npmjs prefetch. Canonical browser about:blank preflight passed with only
HOME=/tmp added to the readonly/network-none disposable container; keep original
crashpad failure as a counterexample. See software-source-preparation-live.md.
No trusted target or policy installation has happened. Production health200,
maintenance actualstatecleared. The new fourth-file Devapp install verification
has independent49/49 tests and no new privilege; real host installer version is
unknown. PRa10 CI finished30success/19skipped, but new fix changes its head again.
