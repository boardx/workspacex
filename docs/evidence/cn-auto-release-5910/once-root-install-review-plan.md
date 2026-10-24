# Once-only CN root software preparation review plan

This is a proposed installation/dry-run matrix, not an execution record. No host
operation was performed for this document. Do not run the full bootstrap script.
No new sudo entry, role, credential, stable12 generation/copy/rotation, production
Compose change, service restart, activation, or accepted-main-cn ref change belongs
to this installation. Root software installation is distinct from deployment.

## Freeze and validate the exact source

After the final changes merge, obtain the exact 40-hex `MAIN` from GitHub's main
ref using the already working authenticated API. Record the successful main CI,
reviewed commit and complete bundle SHA256 separately. No current worktree SHA is
a substitute: the final main SHA is not yet known in this plan.

Use the complete offline Git bundle produced by the Actions source-bundle lane.
On ECS first check it is a regular, root-owned private file with no symlink and
one link, bounded by the existing source-import limits. Verify its externally
recorded SHA256, `git bundle verify`, and exact ref. It must be self-contained
(no prerequisite lines), not shallow/partial/promisor/alternates. Clone to a new
root-only staging directory under `/var/lib/workspacex-cn/`, without hardlinks;
set `GIT_NO_LAZY_FETCH=1`, ignore global/system Git configuration and disable
hooks. Check `git fsck --full --strict --no-reflogs`, exact commit, main identity,
and ancestor relationship with the accepted baseline. Abort rather than fetching
missing objects through GitHub Git protocol. Do not run commands from an unverified
bundle. The API working does not imply Git protocol availability.

Compute a review manifest for each source below with
`git -C "$VERIFIED" show "$MAIN:.harness/scripts/vm/$name" | sha256sum`.
The exact manifest is required before approving/installing; this document invents
no hashes. Installed bytes must match the exact Git blob byte-for-byte and their
recorded SHA256 after installation. All targets and parent directories must be
root-owned, non-symlink and not group/other writable. Validate each final file is
regular, root:root, expected mode, one link. Stage sibling temporary files and
replace entries under the existing canonical release lock; do not truncate or
replace the lock inode. Recheck maintenance hold and absence of an active release.
Retain previous software bytes/hash privately for rollback; rollback does not
restore an old policy over a running attempt.

## Fixed installation matrix

Source basenames below are all under `.harness/scripts/vm/` at exact `MAIN`.
Compare first; unchanged installed files need only verification.

| Source | Installed target | Mode |
| --- | --- | --- |
| deploy-cn-production.sh | /usr/local/bin/workspacex-cn-deploy | 0755 |
| build-cn-release-candidate.sh | /usr/local/bin/workspacex-cn-build-candidate | 0755 |
| verify-cn-release-promotion.sh | /usr/local/bin/workspacex-cn-verify-promotion | 0755 |
| export-cn-domestic-source.sh | /usr/local/bin/workspacex-cn-export-source | 0755 |
| publish-cn-release.sh | /usr/local/lib/workspacex-cn/publish-cn-release.sh | 0755 |
| verify-cn-release-preflight.sh | /usr/local/lib/workspacex-cn/verify-cn-release-preflight.sh | 0755 |
| collect-cn-release-preflight.sh | /usr/local/lib/workspacex-cn/collect-cn-release-preflight.sh | 0755 |

The following helper basenames retain their basename under
`/usr/local/lib/workspacex-cn/`, root:root mode0755:

```text
cn-bootstrap-baseline.cjs
cn-bootstrap-baseline-source.mjs
cn-baseline-schema-contract.cjs
cn-auto-isolated-target.mjs
cn-release-preflight-evidence.mjs
cn-release-orphans.py
cn-bootstrap-source-probe.mjs
cn-controlled-evidence.mjs
devapp-runtime-identity.mjs
cn-auto-evidence-stage.mjs
stage-cn-offline-source-cache.sh
export-cn-domestic-source.sh
cn_auto_source.py
cn_compose_baseline.py
```

These retain their basename at the same directory, root:root mode0700:

```text
cn_maintenance_hold.py
cn_auto_prepare.py
cn_auto_prepare_provider.py
cn_auto_baseline_schema.py
```

The existing maintenance helper must match exact MAIN: source import independently
checks its bytes and mode. Do not remove an existing app-only guard or its policy;
that separate release path is not reconfigured here. No broker helper or governance
key is installed. Signed Devapp staging still requires the existing pinned
`/etc/workspacex-cn/devapp-evidence-public.pem` root600, without key rotation.

Verify existing source caches without changing accepted baseline. Advancing main
source objects/cache main to the exact verified source is a **separate explicit
software-source staging step**, not part of this read-only dry-run. Use the
reviewed fixed source importer and its canonical lock; preserve root-cache and
runner-cache accepted main-cn and repository origin/main-cn baseline. Do not
silently git-pull the existing production repository or replace its old checkout.
The automatic source acquisition lane performs its own admission later.

## Root-only tool checkout and locked dependencies

Prepare `/var/lib/workspacex-cn/auto-preparation-tools/$MAIN` from the verified
complete bundle, a standalone checkout rather than `git worktree add`:
clone `--no-local --no-checkout`, checkout `--detach "$MAIN"`, and verify exact
HEAD, clean tracked/untracked status, fsck, no alternates/promisor/shallow state.
Use root700 for `/var/lib/workspacex-cn`, the tools parent and checkout; verify
all ancestors are root-owned/non-symlink/no022. `/opt/workspacex-cn` is runner-owned
and cannot serve as this trust root.

Read `package.json.packageManager` at exact MAIN (currently pnpm@9.15.0). Use the
existing Node22 and process-local Corepack invocation, not a global install:

```bash
COREPACK_ENABLE_NETWORK=0 /usr/bin/corepack pnpm@9.15.0 --dir "$TOOLS" install --offline --frozen-lockfile --ignore-scripts --package-import-method=copy
(cd "$TOOLS" && /usr/bin/node --import tsx --input-type=module -e 'console.log("CN_TOOLS_TSX_READY")')
```

Use an already verified offline dependency closure/root-private store. Missing
closure => NOT_READY; no network fallback, runner-writable hardlinks, lifecycle
scripts or copying arbitrary workstation node_modules. Resolve pnpm workspace
links within this protected checkout and reject dependency links escaping to
runner-controlled paths. Verify clean Git state afterward. The provider checks
exact tool HEAD, cleanliness and all trusted parent directories again at runtime.
Do not run the actual preparation CLI merely to test module loading.

## Once-installed environment policy: separate exact approval item

`/etc/workspacex-cn/auto-preparation-policy.json` is currently absent. It remains
NOT_READY until an exact reviewed root600 policy is installed. The template is
`.harness/scripts/vm/cn-auto-preparation-policy.example.json`; never install its
placeholder values. Pin toolRevision=`MAIN`, exact toolCheckout above, and actual
installed provider file SHA256. Use only existing credential references:
source migration JSON, CMS recipient certificate/key, existing stable-secret
directory; verify metadata without printing their contents or copying them.
Validate source endpoint/TLS/network against canonical deployment and protected
snapshot, not merely a stale once-written policy. Do not guess restoreRoles or
stable-secret-directory when continuity evidence is incomplete.

Parent supplied actual tools image ID:
`sha256:657a159054f1a890176d8c3476c09e9e4bebc0254a8b6f93a482aa7cb9a04f8e`.
Verify the local Docker ID and expected runtime independently before using it as
both browserImage and nginxImage. PostgreSQL/Redis image IDs must also be actual
cached images with expected versions; never derive identity from mutable tags.
Only then fill exact policy metadata and submit its hash plus this software
manifest for the once-only installation decision. No new credentials are needed.

## Read-only dry-run and unchanged-production proof

Before and after installation, under the canonical lock record only sanitized
identity/status: accepted main-cn refs from both caches and repository,
repository HEAD/clean status, exact live container IDs/image IDs/start times,
current Compose/Nginx pointer identity, and existing stable12 continuity booleans.
Do not output secret values or hashes. The existing stable12 diagnostic honestly
reports only observed comparisons; seven unconsumed production values can remain
unknown and cannot be marked passed by installation.

Read-only validation consists of: installed source byte/mode/hash comparison;
Bash syntax and Node syntax checks of installed helpers; compile Python in memory
(no pycache); root tools tsx load test above; policy schema/binding validation
without invoking any stage; `docker image inspect` and bounded `--network none`
tool-image `node --version`, `chromium --version`, `nginx -v` commands. Such tool
containers are disposable, with 256MiB/.25CPU/pids64 and --rm, no mounts/secrets.
No `--prepare`, snapshot, baseline replay, dump, restore, migration, browser login,
shadow runtime, source mutation or deployment occurs during this dry-run.

Check `/proc/meminfo`/effective cgroup capacity and `statvfs` using the actual
provider's conservative9GiB available-memory and10GiB disk reserve boundaries;
report insufficient capacity as NOT_READY without changing production limits or
cleaning user data. Actual backup/restore additionally needs real database-size
preflight and streaming disk reserve enforcement. A dry-run does not prove those
stages happened. Review installed code independently, verify production identities
remain unchanged, and release the canonical lock. Installation completion alone
is not deployment readiness or success.
