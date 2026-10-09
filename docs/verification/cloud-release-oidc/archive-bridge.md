# Archive bridge — reviewed code, production inputs pending

This code adds an archive-only hosted producer and a separately invoked ECS importer.
It does not run build/prepare/activation on production. No production command, cloud
API, archive upload/download, installation, or workflow dispatch was executed here.

## Boundaries

`export-cn-image-archives.yml` admits only workflow_dispatch on refs/heads/main and repeats
that gate before export. It uses an ephemeral Ubuntu runner, contents:read, no OIDC,
cloud secrets, production environment, or self-hosted runner. Exact control/source SHA,
clean control bytes, full source ancestry and fsck are required. Source is exported from
Git objects. Docker builds five images and saves complete config/layer archives; output
is normalized without filesystem extraction. There is no registry login/push or OSS call.
The workflow uploads only the five archives plus their versioned archive-set/build plan
as short-retention GitHub artifacts. It was syntax-tested, not dispatched.

The archives bind source/control revisions, linux/amd64, SHA256, byte size, config image
ID, individual raw layer sizes/hashes and unique attempt staging tags. Unreferenced
payloads, duplicate members/JSON keys, paths, links, wrong source/architecture or layer
hashes are rejected. The supported transport is single-image uncompressed Docker-save;
compressed OCI layers or unsupported save formats fail closed. No real Docker build was
claimed from offline tests. Producer logs, total time, free space and inodes are bounded.

The prospective importer target is only the existing Shanghai VPC registry
`workspacex-cn-prod-registry-vpc.cn-shanghai.cr.aliyuncs.com/workspacex-prod`,
instance `cri-ttm0916mvdvg4ugx`, role WorkspacexCnProductionEcsRole. Its STS/account and
ACR token calls are explicit EcsRamRole/cn-shanghai/instance scoped with ambient profiles
ignored. Passwords use a bounded anonymous pipe and temporary Docker config, never
argv/environment or printed errors. Root-owned non-symlink installed tools/binaries,
the isolated original Node/TypeScript closure and exact approval bytes must be SHA-pinned.
There is no credential, installer, guessed bucket or transport fallback.

`--check-plan` pins and validates inputs without temporary-file/Docker/cloud writes.
`--publish` additionally requires explicit root-protected publishAuthorized:true, exact
account/ECS/registry/attempt/source binding, approved transport coordinates/principals,
and independent provider evidence for all five target repositories. Deadline/approval,
archive and immutability TTL are checked before side effects; expired/unknown inputs
reject. File copies are bounded; free space/inodes and DockerRootDir are checked. The
existing production release.lock is taken nonblocking, never replaced with a competing lock.

All local and remote target collisions are checked before load/tag/push. Running-target
collisions reject. Registry readback is required even after a lost push acknowledgement;
matching prior publication avoids repeated pushes. Only owned staging references are
removed, never image IDs or shared layers. Local target references and already-pushed
remote objects may remain on failure: publication is not transactional and cannot be
rolled back safely. The lock serializes cooperative local operations, not external writers,
and does not itself provide idempotency. Different bytes rebuilt for the same source tag
are rejected; reproducibility is not assumed.

Actual Docker RepoDigests plus remote digest readback feed the unchanged TypeScript
manifest generator/sealer/validator. Image IDs never substitute for registry digests.
Result files live only under `/var/lib/workspacex-cn/archive-published/<source>/<attempt>`;
they are not installed into activation pointers. Root-trusted dirfd parents, private pending
directory, fsync and Linux renameat2(RENAME_NOREPLACE) publish a complete result atomically.
Completed retries validate and reuse the original seal/receipt bytes. Partial existing
results, mismatched receipts or concurrent destinations reject. Result flags remain
ready:false, prepared:false, productionActivated:false.

## Independent evidence

- `python3 -B -m unittest discover -s tests -p 'test_cn*archive*.py' -v`: 16 contract/fault tests
  and 16 real Node22.20.0 original canonical CLI fixtures pass locally.
- `python3 -B -m unittest discover -s tests -p test_prepare_manual_gate.py -v`: 6 pass.
- actionlint passes for the existing manual prepare gate, manual exporter, and isolated PR tests.
- `.github/workflows/archive-bridge-tests.yml` runs the same archive tests on PRs, including Drafts,
  using an isolated exact-version test runtime. Its Docker boundary is synthetic.

Independent tests found and verified fixes for partial publication before the last target
collision, reused exclusive temporary outputs breaking retry, and post-rename fsync failure
incorrectly deleting a completed result. Added counterproofs reject 61-minute old immutability
evidence, missing observations, missing evidence and actual empty destination overwrite.
The independent reviewer accepted removal of the temporary software-only hardgate after
16+16 passed. That acceptance does not approve production execution or establish real
repository immutability. Offline ownership/Docker fixture inputs are explicitly synthetic.

## Provider proof and remaining production blockers

Stage `immutable-provider-response.json` independently; bind its SHA256 in immutableEvidence
inside the root-protected plan. Its version-1 envelope contains observedAt, accountId, region,
instanceId and repositories keyed by all five repository names. Each value is the complete
raw GetRepository response, not a producer-authored assertion. The reviewed approval binds
the same observation/target and the actual repository IDs. Code requires IsSuccess:true,
Code:success, matching InstanceId/RepoNamespaceName/RepoName/RepoId, RepoStatus:NORMAL,
RepoType:PRIVATE and strict TagImmutability:true for every repository. Observations older
than one hour, missing/unknown/string/bool-like values reject. This validates independently
reviewed input bytes, not the authenticity of an arbitrary JSON document or live cloud state.

Read-only collection, if separately authorized: in region cn-shanghai use ListRepository
for instance cri-ttm0916mvdvg4ugx to resolve exact namespace/workspacex-prod names and IDs;
then GetRepository for api, web, deep-agent, skill-sandbox and postgres-age, passing that
instance and each actual RepoId. Only api's ID is previously established:
crr-ylrpsjvjp41v42rj. Do not guess the other IDs. The console's repository Details view
can show Immutable; do not click Edit/Confirm or change it during collection.
Official fields: https://www.alibabacloud.com/help/en/acr/developer-reference/api-cr-2018-12-01-getrepository

Fresh all-five raw proof is still absent. Real staging object bucket/region/prefix/version/keys,
uploadPrincipal/downloadPrincipal, selected source/control/base digests, production Docker
storage/binary hashes, full approved canonical closure and capacity are also not established.
No sample/mock plan may be promoted as live evidence. No production readiness is claimed.

## First safe integration

Re-read exact main/PR HEADs and live queued/pending prepare runs. Main retains the older
automatic backend-gates workflow_run definition, but the prepare workflow was observed
`disabled_manually` on 2026-10-09. Keep it disabled throughout integration. This disabled
state does not protect or cancel existing queued/pending runs bound to the old definition.
Re-enabling the workflow and canceling old runs each require separate approval and a fresh
process/lock review. Land and verify the reviewed manual-only guard with separate merge
authorization; do not merge an OIDC diagnostic around the old chain. Ready/merge must also
be checked against the reviewed cloud-build-only and DevApp scope gates and external CD.
Only after guard verification, real inputs and separate execution approval should a hosted
archive-only dispatch, approved staging and import/tag/push/readback be considered.
Preparation, activation and live traffic remain separate approval/verification boundaries.

### OSS archive transfer adapter (code and local fixtures only)

`scripts/cn_archive_oss.py` exposes a credential-free Python API, not an installed
production command. `Transfer(port, buildPlan, transport, manifestBytes,
manifestSha256, approval)` requires a separate exact operation approval. The approval
has exactly `schemaVersion: 1`, `transferAuthorized: true`, `operation` (`upload`
or `download`), source/control/attempt identity, archive-set hash,
`transportSha256` (SHA256 of canonical JSON using `cn_image_archive.json_bytes`),
`observedAt`, `expiresAt`, and `versioningFenceProofSha256` binding the independently
collected policy-fence evidence. Both approval and archive expiry are at most one hour;
all hashes, schemas and budgets are checked before transport effects. An approval
object is an input to a trusted supervisor, not a signature or substitute for human
authorization. No workflow invokes this API.

`OssSdkPort` accepts an already authenticated official **oss2 2.19.1** Bucket,
explicit region and independently verified actual session principal. A future
approved supervisor must bind that principal to the actual Bucket credentials,
account and raw caller-identity evidence, install and hash-pin the SDK dependency
closure, and load protected approvals. Those authentication/installation pieces
are deliberately absent: passing an arbitrary principal string is not proof of
identity. There is no environment credential lookup, pip fallback or client auth
implementation here. SDK `timeout` must be between zero and ten seconds. Whole
transfer operations additionally require an exclusive Linux main-thread SIGALRM
timer (at most 1200 seconds); a BaseException cancellation escapes normal SDK
Exception retry handlers. This API refuses a pre-existing timer or a worker thread.

Transport remains the importer's exact six-object schema. This adapter restricts
keys to `cn-image-archives/<source>/<attempt>/<service>.tar` and `archive-set.json`;
`versionId` must be empty. **Versioned and suspended buckets are rejected**:
[OSS ignores forbid-overwrite when versioning is enabled](https://www.alibabacloud.com/help/en/oss/user-guide/overview-78/).
The future supervisor must independently verify an approved policy fence preventing
versioning changes for the entire operation; the adapter's point-in-time bucket
versioning GET cannot prove that fence. No bucket or policy is created or changed.
A valid fence proof hash is mandatory in the approval; its authenticity and actual
policy binding must be verified by the trusted supervisor before calling this API.
Do not disable an existing bucket's versioning to use this adapter.
Supporting approved nonempty object versions would require a separately reviewed
protocol; this implementation fails closed rather than silently using latest.

Upload pins no-follow regular single-link inputs, snapshots privately under capacity
and inode prechecks, and validates all five Docker-save archives before network
writes. It probes all six exact keys before any PUT. Existing objects require full
bounded SHA256/size readback; foreign collisions fail without writes. Simple uploads
and sequential 16 MiB multipart uploads use private ACL and
[forbid-overwrite headers](https://www.alibabacloud.com/help/en/oss/developer-reference/prevent-objects-from-being-overwritten-by-objects-that-have-the-same-names-2).
An uncertain upload acknowledgement permits only exact readback, never a blind second
PUT. The archive-set is the completion marker and is uploaded after all five image
readbacks. An existing marker with missing image objects is rejected. ETags are
multipart transport identifiers, never treated as archive hashes.

Download traverses all directory components with no-follow directory descriptors,
creates private 0700 staging and exclusive 0600 files, bounds and hashes each read,
validates the entire archive set, fsyncs files and staging directory, and publishes
with Linux `renameat2(RENAME_NOREPLACE)`. Existing destinations are preserved. The
returned transfer receipt always has `ready=false`, `prepared=false` and
`productionActivated=false`; a root-installed supervisor is still required to place
this bundle in the importer's exact root-owned inbox. Download does not import it.

Retries converge only on exact existing bytes. Interrupted uploads can leave partial
objects or multipart IDs; no broad list, remote abort/delete, rollback, install,
Docker or cloud permission operation exists. Operators must separately review
orphan cleanup and receive no transactional guarantee. A failed local download
removes only its private pending directory; a directory already atomically published
is preserved even if the final parent fsync fails.

Local tests use fake SDK responses, real filesystem snapshots and Linux no-replace
publication. They exercise corrupt/oversize bytes, last-object collision, lost
acknowledgement, partial upload, symlink/hardlink and ancestor attacks, expiry,
operation/principal/version binding, hard deadline and fsync failures. They do not
prove real SDK/cloud authentication, policy fencing, network transport or performance.
