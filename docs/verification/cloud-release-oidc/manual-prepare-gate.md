# Manual preparation admission recovery

Recovered PR #5512 from `83244c8261ec127224913074d09d87df64daccf8`;
observed main `1762bcc658567d2b8e9681a2d0c884c58c0c231f`.
Both contained backend-gates successful-main workflow_run admission to production
self-hosted export/build/prepare. Manual dispatch also admitted other refs.
The new guard removes workflow_run, requires workflow_dispatch at refs/heads/main
before scheduling the job, and repeats that check at the start of both steps
containing sudo. Explicit source SHA, ancestry, installed-byte comparison,
preparation-input checks, host verifier, frozen-tag controls, production environment
and non-cancelling production concurrency remain intact. Locks serialize operations;
they do not prove rerun or multi-attempt idempotence. Host preparation is a privileged
operation even when public traffic is unchanged.

## Offline evidence

- `python3 -B -m unittest discover -s tests -p test_prepare_manual_gate.py -v`
  executes actual workflow Bash with fresh credential-free environments and local
  gh/git/sudo sentinels. Invalid automatic events, branch/tag/missing refs and SHA
  errors reach no command boundary. The legal case stops at the first sudo sentinel.
- `./node_modules/.bin/vitest run --config .harness/vitest.config.ts .harness/scripts/vm/cn-release-candidate-workflow.test.ts .harness/scripts/vm/cn-production-promotion-workflow.test.ts .harness/scripts/vm/cn-promotion-prepared-receipt.test.ts`
- `node --test .harness/scripts/vm/cn-checkout-offline.selftest.mjs .harness/scripts/vm/cn-domestic-checkout.selftest.mjs`
- `python3 -B -m unittest discover -s tests -p test_release_failure_matrix.py -v`
- `git diff --check`

The original candidate Vitest contract invokes the new Python test, so existing
harness CI exercises it without adding an automatic workflow. No cloud, registry,
production sudo, dispatch, deployment or token issuance is simulated as live proof.
Initialization quick checks passed using pnpm@9.15.0, /tmp caches and
ELECTRON_SKIP_BINARY_DOWNLOAD=1 after Electron download ECONNREFUSED; desktop runtime
and full init --full were not verified.

Current recovery results: all 128 Python tests passed (includes the 6 new admission
tests), the 3 related Vitest files passed 23 tests, and the direct domestic-checkout
selftests passed 12 tests. The 9 release-failure tests are included in the Python
128, not additional unique tests. Independent mutation checks rejected removing
one/both step guards, relaxing the job ref and restoring workflow_run admission.
Actionlint 1.7.7 accepted prepare/release/artifact workflows with shellcheck and
pyflakes disabled; git diff --check passed.

Full Python recovery command: `python3 -B -m unittest discover -s tests -p 'test_*.py' -v`.
It required a local official Node v22.20.0 binary, whose downloaded linux-x64 tar.xz
SHA256 matched Node's SHASUMS256.txt:
`00bbd05e306ea68b6e13e17360d0e2f680b493ef95f2fea1c4296ff7437530bc`.
`npm ci --prefix control-runtime --ignore-scripts --no-audit --no-fund` installed
its checked-in tsx 4.19.0 / zod 3.25.76 lock; temporary toolchain and canonical-runtime
links were used only to satisfy existing tests and removed before committing.
The earlier attempts failed on missing Node22/runtime and are superseded by the
successful recovery run. No test gate was weakened. `harness readiness` completed;
`harness tick` reported missing COORD_GATEWAY_URL (no gateway credentials/settings
were created), so no authoritative worker loop was registered in this environment.

## First safe merge plan (not performed)

1. Read latest main and PR HEAD again. Extract only this manual gate and its tests
   into a separately reviewed minimal change based on latest main. Do not merge
   the full release/OIDC draft to obtain token issuance or default-branch registration.
2. Read active/queued legacy prepare runs. Observed run 37786473841 on main was pending
   during this review. New YAML does not retroactively gate already-created runs.
   Any operator cancellation/approval decision is separate; none was made here.
3. Account for backend-gates main-push Devapp deployment: even a guard-only merge can
   trigger that existing automatic chain. Resolve explicit authorization for that
   effect before merging; do not silently disable/enable workflows.
4. Review the precise merge result, run gate simulations and required CI, then use
   a separately authorized merge. Immediately read the resulting default-branch
   YAML and new runs to confirm manual/main admission. Existing runs remain separate.
5. Keep #5512 Draft until actual HK ACR edition/target, GitHub OIDC RAM trust and
   resource grants, protected matching executor installation, three-database
   qualification, migration/recovery and public-browser business acceptance are
   independently satisfied. Then freeze a separately approved exact candidate
   containing matching control bytes; no old candidate equality bypass.

This recovery changes no IAM/network/credential configuration and performs no
workflow dispatch, upload, deployment, main merge or workflow enable/disable.
During that code recovery, provider 1177216024653153 and ECS i-uf6ga92ewloganobbln6 were not accessed or changed. Subsequent separately authorized diagnostics are recorded below.


## Persistent release-plan status — 2026-10-08 19:02 UTC

This update records browser-reported production receipts supplied by the parent
thread. It performs no production operation and makes no new remote verification
claim. The original 124-node diagram is unreadable in this workspace; its file has
not been edited. This existing verification document retains the actionable plan.

The independent diagnostic CLI installation is **approved, installed, and file
verified**, replacing its former pending-installation-approval state:

| Event | UTC time | Evidence | Result |
| --- | --- | --- | --- |
| User installation authorization | 18:51:34 | Parent-thread user approval | Independent CLI installation only |
| Installation | 18:54:20 | Invoke `t-sh06zg3qrmn0kqo`; command `c-sh06zg3qrm816o0` | Exit 0; 4 seconds |
| Independent lstat/hash verification | 18:56:03 | Invoke `t-sh06zg3wa0fpd6o`; command `c-sh06zg3w9zy82rk` | Exit 0; 1 second |

Verified installed file: `/usr/local/lib/workspacex-diagnostics-aliyun-3.0.277/aliyun`,
root uid/gid `0:0`, regular file mode `0755`, size `60804395` bytes, actual SHA256
`f8726dbe5a88c45e0745e308ba23234d928519b9cb33c96a4bff0bbee1c85c05`.
The dedicated directory is root-owned `0700`; its inspected parents are root-owned
`0755`. The existing CLI and deployment tools were not overwritten; PATH and IAM
were not changed. Installation/file verification did not execute the CLI or call
cloud APIs. File identity is not role authorization or release readiness.

At 18:56 UTC the parent thread requested separate user approval for the reviewed
one-time read-only API command, maximum eight control-plane calls. As of the
reported 19:02 UTC check, no user reply or additional execution receipt exists.
The API command remains **approval pending / not executed**; its reviewed shell
SHA256 is `5674a6731cf5c232b40360fda3f4e3db950d283363e394605aa93fe4f97013e0`.

Current dependencies and next authorized boundary:

1. Wait for separate API-execution approval; do not infer it from installation
   approval. No CLI/API execution, workflow action or new production write is
   authorized by this status update.
2. If separately authorized, run only the reviewed fixed command: explicit ECS
   RAM role `WorkspacexCnProductionEcsRole`, ignored profiles, STS account check,
   bounded HK enterprise enumeration/endpoint reads and four fixed Shanghai RDS
   Describe calls for `pgm-uf6rg214cp381l49`. Redis ID remains unknown and is not
   guessed or queried. No credential/token export or deployment is included.
3. Role access, actual HK ACR target/edition, trusted matching production
   repository/tool closure and all seven production acceptance steps remain
   unproven. Installation does not resolve the observed mixed tool versions or
   untrusted repository paths. No merge, dispatch, build, migration, activation
   or public-business acceptance has been established by these receipts.
4. Preserve the first-safe-merge constraints above and Draft PR #5512. This local
   status edit does not commit/push code or claim a production release.


## Current release-plan update — 2026-10-08 19:10:47 UTC

This supersedes the API-pending state at the historical 19:02 checkpoint. The parent
thread reports completion of the separately approved reviewed read-only command:
Invoke `t-sh06zg57mzy5vcw`, command `c-sh06zg57mz96vwg`, exit 0 in 3 seconds.
All six performed calls returned stage status `ok`: STS caller account
`1177216024653153` matched using the explicit existing ECS role; the complete HK
enterprise list was empty, so no endpoint calls ran; the four fixed RDS Describe
calls succeeded. These listed role/API accesses are now demonstrated, not pending
permission checks. This edit itself made no cloud call.

RDS `pgm-uf6rg214cp381l49` reported Running/PostgreSQL, TLS disabled, a present
allowlist without an all-addresses rule, and configured backup retention. These
projections do not prove the expected PostgreSQL major/Serverless category, exact
application CIDR set, required retention days/schedule, three database permissions
or data-plane connectivity. Redis remains unchecked. The enterprise empty result
does not establish absence of personal ACR or Docker registry access. OSS object
access, registry credentials/push/pull and GitHub OIDC role access remain untested.

### Actual candidate requirements and fastest next boundaries

- At reviewed PR HEAD `41be9fe7eaa08870ad0a01059ceed6c359f25a9d`,
  `managed-data-preflight.ts` rejects SSL off with `rds_tls_not_enabled` when the
  protected candidate has no `rdsTlsException`. With the existing
  `aliyun-postgresql-serverless-no-tls` exception, it requires SSL off, a matching
  Serverless provider identity and exact non-hidden application CIDRs, not merely
  absence of `0.0.0.0/0`. `runtime-bundle.ts` selects `sslmode=disable` only for
  that exception; otherwise it requires `verify-full`. Redis still requires TLS.
- Historical nonsecret evidence `deploy/aliyun/cn-release-existing-transport-config.json`
  records the existing production exception and `192.168.100.40/32`, observed
  2026-10-03 17:44:02 UTC, configuration SHA256
  `76a7f158cf939504439d6d4b08bf1ce990e6f2ab262017ff9f462799b8f7c4e0`.
  This is not fresh evidence that the future candidate has the same protected
  config/hash. Reuse the already approved exception if exact candidate/provider/
  network binding verifies; do not enable SSL, change ACLs or introduce a new
  generic insecure flag.
- The hosted code already supports existing personal HK ACR via edition `personal`,
  a fixed Alibaba hostname/namespace and existing protected username/password.
  This supports artifact-only preparation without creating an enterprise
  subscription. It currently emits `productionHandoffSupported=false`;
  `release-cn.yml` full-release admission still requires enterprise, and the
  protected collector unconditionally requests an enterprise token. Therefore
  personal ACR is not a ready production handoff. The ECS role Describe successes
  do not substitute for personal registry credentials. No token is acquired by
  this planning step.
- Private OSS may carry exact source/manifest/control artifacts using separately
  proven object permissions. No reviewed current lane imports OSS image archives
  as a replacement for registry publication: `hosted-release.py` requires push,
  pull and registry digest readback; handoff verifies registry identity/digests.
  A registry-free OCI/Docker archive route would require producer/importer,
  digest/platform/revision binding, receipts, safe extraction and preflight/
  activation consumer changes with tests/review, followed by separately approved
  upload/load writes. It is not an existing ready-to-run fallback.

Minimum remaining exact nonsecret inputs: approved application candidate SHA/
release/baseline; protected candidate config path/hash and exception binding;
Redis instance ID; existing HK personal registry hostname/namespace and availability
of already approved registry secrets; the already known private OSS bucket/region/
endpoint/exact object key/version/hash and permitted upload/read principal. These
OSS coordinates are not present as a verified fixed object in this workspace and
will not be guessed or broad-listed. Do not expose secret values in the plan.

Next planning order: preserve the guard-only first-safe-merge plan, re-read current
main/PR and legacy queued/pending prepare runs before any push/merge, resolve
operator handling of old runs and existing automatic Devapp merge effects, then
separately authorize the minimal guard merge. Do not merge the full OIDC draft
just to issue tokens. In parallel, confirm the exact candidate config and existing
personal-registry/OSS inputs; any credential use, registry push/pull, OSS upload,
trusted tool installation, build, migration or activation needs its concrete
execution boundary. Seven-step production acceptance remains incomplete.


Updated registry decision (parent browser evidence): HK personal view also shows
only create buttons, with no existing instance/repository observed. Do not create
one or recommend personal ACR for production. Official ACR documentation states
personal edition has no SLA and should not be used for production:
https://help.aliyun.com/zh/acr/product-overview/what-is-container-registry .
The earlier personal-handoff evaluation is superseded by this evidence.

The no-new-subscription proposal is a separately reviewed **private OSS archive
transport using the existing approved tool-package bucket/prefix**, subject to
exact object scope and real access evidence. A bucket's existing tool-package use
does not prove image-object permissions, sufficient quota or complete image bytes.
No new bucket, prefix, subscription, ACL or credential is proposed implicitly.
Existing region/endpoint/bucket/exact approved keys must come from the parent's
known nonsecret artifact plan; they were not recoverable as fixed verified
coordinates here and will not be guessed. First evidence should be bounded
metadata/read of an existing approved object and exact object policy scope, not a
broad bucket list or a write probe. Upload/write ability cannot be inferred from
STS/RDS successes or a successful object read.

Current minimal code gaps are concrete:

1. Producer: add bounded archive export to the exact-source isolated build path
   (cloud-build-only.py uses buildx --load in a manual measurement rehearsal
   with explicit full source/control SHAs and a digest-bound shared plan),
   with complete target-service
   and required dependency image inventory, platform/revision labels, layer/config
   digest verification, archive SHA/size, and sealed transport receipt. It must
   not fabricate a registry RepoDigest from a local image ID.
2. Transport: conditional-no-overwrite upload/readback in only the already
   approved OSS object scope; an exact reviewed expected receipt must bind
   object version/hash, source/control SHA, attempt, expiry, platform and each
   image. Producer credentials/permissions remain a separate authorization
   question; ECS role read success would not supply GitHub upload credentials.
3. Consumer: new root-protected safe downloader/archive verifier/importer plus
   post-import image/config/layer/platform/revision verification. No current
   reviewed release lane has Docker archive load support. Docker load itself is
   a host write requiring separate approval and is not activation/traffic switch.
4. Protocol: versioned archive transport in manifest/seal/receipt, explicit local
   immutable image identity and pull-never behavior; adapt protected preflight
   and activation consumers to verify this identity instead of assuming registry
   readback. Existing digest-qualified references and RepoDigests checks cannot
   be waved away. Preserve baseline CAS, canonical lock, expiry, tool/source
   equality, all database gates and seven-step production acceptance.

GHCR evidence is limited: mirror-minio-controlled-registry.yml contains a
manual protected mirror operation with packages:write and ghcr.io login. That
proves repository code for a MinIO mirror, not a currently authorized application
image publishing scope, live successful run, installed ECS credential or China
pull connectivity. Current hosted ACR auth accepts only HK Alibaba endpoints.
Changing to GHCR would therefore add auth/namespace/consumer and network proofs;
it is not a demonstrated faster fallback and is not selected automatically.

Next concrete work is a reviewable OSS-archive protocol/code package and mock
roundtrip/tamper/platform/source/expiry/oversize/path-traversal failure tests,
while obtaining exact existing object coordinates and source/control/candidate
bindings. No production upload path change or write is authorized by this plan.
Actual upload/import/tool installation and later migration/activate each require
their exact reviewed execution approvals. Before any guard merge, re-read the
old prepare queue and resolve its handling plus automatic Devapp merge effect;
new guards do not cancel old runs and locks serialize rather than prove idempotence.

The only document changed by this task is this existing plan. Independent review
covered source/history conclusions; the browser receipts are parent-supplied.
No TLS/ACL/IAM change, registry token request, object upload/read, build, merge,
queue cancellation or production execution was performed.


## Current shortest-route decision — existing Shanghai ACR discovered

This supersedes the earlier registry-free OSS production-consumer proposal.
Parent browser evidence identifies the existing Running Shanghai enterprise
economy instance `workspacex-cn-prod`, ID `cri-ttm0916mvdvg4ugx`, namespace
`workspacex-prod`, with nine private repositories: api, web, deep-agent,
skill-sandbox, postgres-age, base-node, base-python, base-postgres, base-redis.
API repository ID is `crr-ylrpsjvjp41v42rj`; its tags are immutable. Known VPC
host is `workspacex-cn-prod-registry-vpc.cn-shanghai.cr.aliyuncs.com`. Browser
reports no enabled public access entry. No network or target configuration was
changed by this analysis. Do not buy HK ACR or create a personal registry.

Existing same-region code is already substantial:

- build-cn-release-candidate.sh defaults ACR region to cn-shanghai and obtains
  enterprise authorization with explicit EcsRamRole/name from protected
  publish.env, using temporary Docker config.
- publish-cn-release.sh accepts the given VPC hostname/namespace, builds exact
  source/platform/labels, pushes immutable tags with bounded recovery, pulls
  back and emits manifest/seal using verified registry identities.
- Historical cn-release-9b25-artifact-readonly-20261004.json records five
  application/data-image references in this same registry;
  cn-release-backup-client-metadata.json records a cached base-postgres RepoDigest
  from 2026-10-03. This demonstrates the old target was real, not current new
  candidate availability or present token/push permission.
- prepare-cn-release.yml targets only self-hosted/linux/workspacex-cn-production.
  Current supported GitHub runner-list read returned HTTP 403 Resource not
  accessible by integration; no bypass or alternate credential extraction was
  attempted. Online runner identity/ownership/busy state remains unknown.
  Installed deploy/identity versions and repository trust remain mismatched as
  previously recorded. Do not resume old queued runs or build on production
  just because the old code has this capability.

Hosted draft exact gaps: hosted-release.py requires HK region;
aliyun-release-auth.py validates HK hosts and hardcodes HK token region;
create-hosted-handoff-expected.py requires HK. They need a narrowly bound
Shanghai enterprise target option and matching tests, not mere variable changes
or general removal of region validation. Existing VPC and future approved
public aliases must resolve to the same instance/namespace and final verified
repository digest; do not guess a public hostname.

| Option | Minimum real change/dependency | Execution time dependency |
| --- | --- | --- |
| Existing controlled non-production VPC builder | Identify an already available builder in the connected VPC, protected source/tool closure, exact base digests and permitted enterprise authentication; use existing publisher logic, keeping production preflight/prepare separate | Fastest code path if the machine already exists and qualifies; elapsed time then depends on actual cache/build/push evidence. If no such machine exists, machine/role/network setup needs separate approval and cannot be promised immediate |
| Fixed-egress hosted builder to restricted public ACR | Approve/establish a real fixed-egress runner plus the exact public endpoint/allowlist; resolve GitHub OIDC role/grants; make the three narrow Shanghai target changes | Blocked first on network/runner/IAM decisions. Standard hosted runner is not assumed to supply a fixed approved address. No automatic public opening |
| Cloud archive transit, ECS import/push to existing VPC ACR | Add bounded exact-source archive export and protected load/tag/push importer; reuse approved OSS transit scope, existing ECS role and existing immutable-tag/pull/readback/seal logic | Does not need public ACR or a new GitHub OIDC upload principal if an existing approved manual artifact upload channel is used; depends on archive transfer size, available ECS disk and short bounded import/push. No measured build/transfer ETA exists |

Preference: qualify an existing non-production VPC builder first; if none is
available, prepare the archive-transit **import-and-publish** adapter. OSS only
transports image bytes here; it does not replace the production registry or
manifest protocol. Preserve final ACR RepoDigests/readback; do not treat local
image IDs or archive SHA as registry digests. Importer must authenticate the
exact expected artifact/source/control/attempt, verify archive/config/layers/
platform/revision, reject replay or conflicting existing immutable tags, hold
the canonical production lock for its bounded host/registry writes, and never
build, prepare, migrate, activate or touch running services. The full expected
image set remains the existing manifest-required set; no silent omission of
postgres-age/redis or foundation bindings. Archive import and push require
separate concrete authorization.

Next minimal evidence: exact selected candidate SHA/release/baseline and its
current registry tags/digests; current VPC endpoint/access attachment; whether a
controlled non-production builder actually exists (host identity/labels/tool
hashes); fresh nonsecret publish target bindings; fixed existing base-image
digests; scoped token/registry authorization evidence only after approval.
The existing approved OSS bucket/key scope and uploading principal are needed
only for the transit option; do not change the prefix or credentials implicitly.

Before a guard-only merge or newly authorized manual run, re-read exact main/PR
and old prepare runs, resolve old queue handling and automatic Devapp merge
effects, install matching trusted control bytes only under separate approval,
and confirm the guard on current default-branch bytes. New code cannot gate
old already-created runs; the lock serializes but does not prove idempotence.
TLS existing-exception binding, Redis and seven-step production acceptance
remain required. This update contains proposals, no execution or target switch.

### Manual build-only measurement contracts

The rehearsal accepts an explicit full source SHA, checks source/control identity
before and after each build, and shares one hash-verified plan of public base-image
digests. Five services run sequentially on standard isolated GitHub runners. Only
JSON measurement receipts are retained for one day; all production readiness and
activation fields remain false. It has no cloud credentials or production runner.

The 2 GiB per-image archive limit is checked after Docker save finishes. The
4 GiB disk margin and 12 GiB preflight bound are rehearsal limits, not proof of
actual capacity. Disk measurements sample the workspace filesystem and do not
guarantee Docker storage coverage or the true peak. The formal exporter retains
its existing whole-release storage requirements. No actual release-image build,
export, upload, import or deployment was performed to validate this code change.

PR CI runs credential-free build-only unit contracts alongside archive contracts.
The first safe merge still requires exact current-main review, production workflow
state and external trigger inventory, and acceptance of the existing main merge
side effects. A production lock serializes work; it does not provide idempotency.
