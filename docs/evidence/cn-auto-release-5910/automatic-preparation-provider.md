# Automatic preparation provider contract

This is implementation and synthetic integration evidence, not a claim that a
production backup, actual candidate browser test, or production activation passed.

## Fixed interfaces

The existing candidate builder invokes the source-pinned root CLI with the exact
source SHA and attempt, while retaining canonical release lock FD 9:

```sh
node --import tsx packages/cloud-deploy/src/cn-auto-preparation-cli.ts "$source_sha" "$attempt"
```

The CLI consumes the create-once root-private request at
`/etc/workspacex-cn/auto-preparation-requests/<sha>/<attempt>.json`. It contains
`identity`, manifest/seal/real migration plan protected raw references, and the
actual prebuild evidence/validated pair. The request producer copies published
root:runner manifests to byte-identical root600 `input-manifest.json` and
`input-seal.json` inside this attempt. The provider and renderer verify the
manifest's request-bound raw hash before using it.

Stages are `backup`, `restoreIsolated`, `shadowReadiness`, `shadowBusiness`, and
`cleanupIsolated`. The fixed root dispatcher reads stdin containing identity,
immutable image digests, semantic migration plan hash, and cumulative raw artifact
dependencies. It executes only the installed, hash-pinned Python provider. Stage
intents and output are create-once; an unknown outcome requires reconciliation.
Every provider reference is independently opened without following links and
stream-hashed by the dispatcher. References must be private regular root files
within the exact attempt. Metadata is capped at 16 MiB, encrypted dumps at 64 GiB.

The prepare sequence deliberately defers the existing canonical preactivate
collector until after real backup, restore, applicable migration rehearsal, and
candidate startup. This breaks the previous dependency cycle. The collector's
existing validated metadata policy remains authoritative. Cleanup runs on success
and all provider/collector failures, including backup timeout. The completed
receipt is saved only after cleanup succeeds; its earliest evidence expiry wins.

## Actual operations and boundaries

The provider runs pinned PostgreSQL16 pg_dump with fixed read-only PGOPTIONS and
`--serializable-deferrable`, using the existing authorized credential without
altering its grants. It streams three database snapshots through CMS encryption;
plaintext dump files are never created. It checks real exit codes, byte counts,
ciphertext hashes, and joined children. It does not claim account-level read-only
grants or simultaneous cross-database consistency.

Before backup, the once-installed credential's host/port/database/TLS mode must
match both candidate database and migration secretRefs. The exact protected
source-binding bytes must hash to the plan's snapshot evidence, match this
source/baseline/attempt, canonical configuration hash, RDS instance/region and
endpoint hash. TLS CA bytes or the canonical explicit no-TLS exception must
match. A different authorized backup user is allowed; a stale RDS endpoint is not.

An attempt-owned internal Docker network hosts local PostgreSQL/AGE and Redis.
Restore preserves source owners and ACLs using local role identities, without
copying production role passwords. Real COPY row fingerprints and sequence values
are compared between the encrypted archive and a fresh restored-cluster dump.
Only then does the canonical renderer create fresh candidate Compose/environment
files, local FS storage, sandbox/session directories, and temporary TLS files from
the existing TLS JSON secret. No production Compose rewrite, production socket,
new public port, global role change, or paid cloud resource is used. All Docker
jobs have fixed resource budgets and cryptographic attempt ownership.

The shadow profile has API768 MiB, Web512 MiB, Agent1536 MiB, Sandbox256 MiB,
Postgres768 MiB, Redis128 MiB, old API512 MiB, browser512 MiB, nginx64 MiB, and
one512 MiB helper budget. Container limits sum below5.5 GiB; the fixed6 GiB budget
includes controller allowance. Total CPU limits are below3 cores. Before work,
the host's actual MemAvailable and current-process cgroup plus ancestor limits
must leave6 GiB plus3 GiB production headroom. Three real read-only
`pg_database_size(current_database())` queries require disk free space for three
times total source database bytes plus a fixed10 GiB reserve. The dump stream
checks real free space before each1 MiB chunk; a concurrent reserve watchdog also
aborts and joins restore/fingerprint pipelines. Insufficient capacity returns
NOT_READY without changing production limits or deleting user data.

The ordinary plan must be ready, drift-free, blocker-free, and contain only
additive pending SQL. Zero pending requires no compatibility claim. Additive SQL
is executed by the actual candidate migrator in the clone, with exact applied and
skipped sets and independent full ledger checksum readback. The old immutable API
image comes from the captured protected baseline. Distinct old/candidate runtimes
are independently inspected against the same clone and private network. A freshly
seeded nonce actor is read back before the existing real HTTP old-read/write and
candidate-read/write probe runs once. Its sanitized transcript hashes, all four
checks, archived project SQL readback, and cleanup are required. Destructive,
unknown, out-of-order, or checksum-drift plans cannot use this path. The current
reported 16 pending unsafe migrations therefore remain blocked.

Shadow readiness executes existing real data/service readiness producers and
retains sanitized results plus raw hashes. Shadow business runs the existing
browser login and authenticated notifications contract against an isolated TLS
ingress. Local FS shadow evidence does not claim production OSS or canonical8/8
acceptance; those existing production activation gates remain unchanged.

Cleanup enumerates only exact owner-labeled Docker containers and networks,
removes attempt credentials/runtime directories, and independently confirms
absence. Encrypted backups and sanitized evidence remain private. A killed
dispatcher cannot remove daemon containers itself; the mandatory independent
cleanup stage discovers them by owner rather than relying on process ancestry.
The outer CLI handles SIGTERM/SIGINT/SIGHUP, stops and joins active detached stage
or collector groups, and runs independent owner cleanup before nonzero exit.
Cancellation cannot start another mutating stage or emit preparation success.
An already running cleanup is joined without interrupting it. These graceful
signal guarantees do not claim recovery after SIGKILL or host power failure.

## Once-installed policy

The installable template is
`.harness/scripts/vm/cn-auto-preparation-policy.example.json`. Root installs one
private policy with the exact imported tool SHA, provider SHA, cached immutable
PG/AGE, Redis, nginx, and Node/Chromium image identities, root tool checkout with
Linux dependencies, existing stable-secret directory, source Docker network, and
existing credential/CMS references. Source credentials reuse
`/etc/workspacex-cn/secrets/recovered/migration.json`; TLS uses the canonical
candidate configuration's existing JSON secretRef. No new account, role, secret,
per-release command, SQL, or human approval is supplied by a workflow caller.
Missing/mismatched installed policy or images produces NOT_READY.
The fixed tool checkout is
`/var/lib/workspacex-cn/auto-preparation-tools/<toolRevision>`; all parents must be
root-owned directories without group/world write before Git HEAD and clean-state
checks. `/opt/workspacex-cn` is not accepted as a tool trust root. The isolated
bootstrap environment explicitly uses starter profile; this private local target
does not add a production TLS exception.

## Executed verification

```sh
pnpm exec vitest run --config .harness/vitest.config.ts packages/cloud-deploy/src/cn-auto-preparation.test.ts packages/cloud-deploy/src/cn-auto-preparation-process.test.ts packages/cloud-deploy/src/cn-auto-preparation-render.test.ts packages/cloud-deploy/test/cn-fast-safe-release.test.ts
pnpm --filter @repo/cloud-deploy typecheck
python3 -m unittest discover -s .harness/scripts/vm -p 'test_cn_auto_prepare*.py'
CN_AUTO_PREPARE_DOCKER_TEST=1 python3 -m unittest discover -s .harness/scripts/vm -p test_cn_auto_prepare_provider.py
```

Latest logs: `/tmp/cn-auto-preparation-tests.log` (54/54),
`/tmp/cn-auto-preparation-typecheck.log` (exit 0),
`/tmp/cn-auto-python.log` (23 tests, one opt-in Docker skip), and
`/tmp/cn-auto-provider-docker.log` (nine tests, real Docker lane, 18.55s).
Durable copies of these logs are the adjacent `automatic-preparation-*.log` files.
Docker lane covers synthetic encrypted three-database restore, changed-row
detection, internal-network/no-default-route isolation, and a real provider
timeout leaving a daemon container followed by independently verified cleanup.
It does not exercise actual release images or a production database. No host
installation, Git staging, commit, push, or production action was performed by
this worker.
The macOS Docker lane explicitly substitutes host Linux memory availability and
synthetic source-binding authorization; source binding and Linux cgroup/capacity
failure branches are separate controlled tests. The encryption, pg_dump, restore,
row-fidelity detection, internal Docker isolation, and cleanup remain actual
operations against synthetic PostgreSQL/Redis. The cancellation tests send each
real signal to an outer Node process running the production lifecycle controller,
verify the real detached child is gone, then verify a separate cleanup subprocess
ran. Renderer tests execute the canonical renderer with controlled filesystem and
secret inputs and a real generated TLS certificate.

After the last real Docker run, all four commands below returned empty output
(exit 0):

```sh
docker ps -a --format '{{.Names}}' --filter label=wsx.auto.owner
docker network ls --format '{{.Name}}' --filter label=wsx.auto.owner
docker ps -a --format '{{.Names}}' --filter name=wsx-autop-test-
docker network ls --format '{{.Name}}' --filter name=wsx-autop-test-
```
