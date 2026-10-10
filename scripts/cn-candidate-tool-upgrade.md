# Candidate tool closure upgrade transaction (Refs #5547)

This narrowly scoped root installer upgrades the eight existing candidate tools
from exact `295c19f512335eb2918a41183881a89cf0729b9c`, adding only
`cn_candidate_revalidation.py`. The eight old SHA256 values are embedded and
checked against the original Git objects. No publisher, application, Docker,
registry, service restart or migration command is executed.

The installer reuses the exact pinned `cn-tool-install-transaction.py` engine.
Each replacement is atomic; the nine-file set is a journalled transaction, not
one physical multi-file rename. The entry is replaced last and the committed
journal is written only after complete readback. A concurrent entry sees either
its complete approved snapshot or a hash rejection before imports: existing
entry code verifies the full closure before loading modules. Already snapshotted
old code can finish under its own valid approval; this operation does not kill
or revoke a process. The canonical release lock prevents concurrent publication
mutations while installation is in progress.

## Independently reviewed package

Create root:root private directory
`/etc/workspacex-cn/candidate-tool-upgrade/UPGRADE_ID/` through a separately reviewed
staging operation. It must contain:

- `manifest.json`, 0600, exact schema from `validate`, externally pinned raw SHA.
  It binds old revision/eight hashes, exact new full revision and all nine new
  hashes/sizes, installer/helper bytes, fixed ECS and a maximum one-hour explicit
  installation approval. Unknown files/targets are rejected.
- `upgrade-cn-candidate-tools.py`, 0700, the independently reviewed exact installer.
- `cn-tool-install-transaction.py`, 0700, exact embedded helper SHA; verified bytes
  are compiled in memory, with no ambient helper import.
- `payloads/NAME`, nine 0600 regular single-link files from `git show
  NEW_EXACT_SHA:TRACKED_PATH`. The two import entries come from
  `.harness/scripts/vm/`; other names come from `scripts/`.

The manifest's revision/hash mapping must be generated from the approved Git
objects and independently reviewed before root staging; merely naming a new
revision does not authenticate arbitrary payload bytes. This installer does not
fetch Git objects or install credentials. No mutable branch or guessed new SHA is
accepted. The new exact revision is a manifest parameter, not baked into this PR.

```sh
python3 -I -S -B /etc/workspacex-cn/candidate-tool-upgrade/UPGRADE_ID/upgrade-cn-candidate-tools.py \
  --check-plan UPGRADE_ID APPROVED_MANIFEST_SHA256
python3 -I -S -B /etc/workspacex-cn/candidate-tool-upgrade/UPGRADE_ID/upgrade-cn-candidate-tools.py \
  --apply UPGRADE_ID APPROVED_MANIFEST_SHA256
```

Both operations acquire the existing canonical lock without creating/replacing
its inode and check live fixed-host Shanghai identity using IMDSv2. Check mode
performs no target/staging/backup writes. Apply first validates every old target,
the new file's absence, every payload and Python syntax without executing it.
Only the fixed backup subtree `/var/lib/workspacex-cn/candidate-tool-upgrades`
may be created. The unique upgrade directory holds 0600 before-images, manifest
binding and crash journal. Stages and backups are fsynced before replacements.
Target owner/mode/link/hash CAS is repeated immediately before each replacement.

Ordinary failure or caught interruption rolls back only transaction-owned
inodes. A foreign replacement is preserved, rollback reports incomplete and all
backup/journal evidence remains. No automatic retry, backup deletion or pruning
is performed. A used upgrade ID is never overwritten.

## Interrupted recovery

SIGKILL cannot run rollback. Before resuming any publisher, read the retained
journal. A separate current `recovery.json` approval (0600) must bind kind
`cn-candidate-tool-recovery-v1`, upgradeId, original manifestSha256, exact current
journalSha256, issuedAt/expiresAt (at most one hour), and recoveryAuthorized=true.
Its raw SHA is independently reviewed. Recovery also requires the exact original
installer/helper/manifest package. The original manifest may be expired, but its
recorded transaction admission must have occurred within that original window.

```sh
python3 -I -S -B /etc/workspacex-cn/candidate-tool-upgrade/UPGRADE_ID/upgrade-cn-candidate-tools.py \
  --recover-reviewed UPGRADE_ID APPROVED_RECOVERY_SHA256
```

The same release lock and real host identity checks apply. Recovery revalidates
journal targets and binding and only restores owned inodes. A committed journal
is reported as committed and is not reversed: a rollback of a completed upgrade
would need a separately reviewed reverse transaction. If an acknowledgement is
lost after commit, inspect this journal instead of rerunning installation.

Local tests use real files, CAS races, lock contention, injected failures and
SIGKILL/recovery. Root ownership is mapped to the fixture user's ownership;
these are not production installation or application acceptance receipts.
