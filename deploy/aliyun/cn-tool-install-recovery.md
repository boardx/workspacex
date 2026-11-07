Review proposal only. No production execution or sudo permission changes.

Proposed CLI:

```
python3 .harness/scripts/vm/cn-tool-install-transaction.py --recover-reviewed ROOT_PRIVATE_MANIFEST MANIFEST_SHA256 BACKUP_BASENAME JOURNAL_SHA256
```

The production wrapper accepts fixed root UID/GID, inherited canonical FD 9, and `/var/lib/workspacex-cn/trusted-install-backups`. The basename is a single `exact-` component; absolute paths, slash, traversal and symlinks fail. Root and selected backup directory must be root:root 0700 with protected ancestors. The root-private manifest is pinned by hash and passes the same exact tool-root Git/FILES/byte/closure validation as installation. All target paths and old/new metadata come from that validated manifest; the journal has no independent target authority.

Installation records `manifest-binding.json` root:root 0600 before preparing targets, and repeats its binding inside the durable journal. The binding contains exact manifest hash, tool revision and canonical JSON target-metadata hash. Recovery requires the separately supplied exact journal hash, exact private binding equality, complete ordered target equality and safe stage/inode schema before any journal or destination mutation. Arbitrary journal targets, stage-path traversal, different manifest hash, different journal hash, foreign backup symlinks and escapes fail without modifying the pending journal or installed targets. Existing legacy unbound journals cannot pass this production protocol.

Recovery holds the canonical inherited lock and reuses the transaction-owned inode checks. `committed` and `recovered` are historical transaction states and do not assert current service availability. Output remains `ready=false`. An interrupted recovery changes journal bytes, so a subsequent explicitly reviewed attempt must supply the new journal hash; it never silently ignores a supplied stale pin.

The explicit profileTransactionsV1 protocol is implemented; legacy profileEntries must remain empty. The historical first proposal had toolRevision=null and no packaged offline tool Git artifact, so it could not pass exact binding and host trust checks. Missing inventoryEvidenceV1 or profileTransactionsV1 still fails before writing; proposal truthiness never authorizes a target. No new recovery privilege or installation authorization is implied.

Local tests: 12 methods pass, including reviewed legal recovery and 6 rejection subcases, actual SIGKILL and foreign-holder tests. Production root manifest/FD 9/Git filesystem checks have not been exercised on the host. Actual storage power loss is not tested.

profileTransactionsV1 admits exactly one source-bound create or replace proposal. Its consumerSource is a FILES member named cn_maintenance_hold.py, read as the same exact trusted Git blob. Python AST profile=Path(...) and read(profile, mode) define the only profile target/mode. Content is recomputed as {toolRevision, filesSha256} from all FILES new hashes and encoded with sorted JSON keys plus newline; exact hash and bytes must match. Old identity must equal the readonly inventory's complete present or absent identity. Replacement first reconstructs the old profile from that exact old tool Git schema, its full FILES and actual runtime inventory; editing a few hashes is not a valid replacement. The profile target is appended to manifest-derived scripts before their single transaction, journal, readback and rollback; it is never written in a separate post-install step.

inventoryEvidenceV1 supplies root-private absolute inventoryPath/inventorySha256 and providerReceiptPath/providerReceiptSha256, plus reviewed expected request {region, instanceId, sourceInvocation, commandId} and ttlSeconds<=3600. Receipt success/exit/dropped and exact request must match. Local inventory bytes bind their hash; provider output bytes are deterministically reconstructed by removing sourceInvocation and encoding sorted JSON plus newline, then bind outputSha256. startTime and observedAt must be not future, within TTL, and within 300 seconds of each other. A null finishTime remains null. All file old metadata and profile old identity are compared to the same inventory. A receipt boolean alone is never used as proof.

Absent targets use exclusive hard-link publication followed by unlinking the private same-directory staging name, never overwriting a file that appeared after absent CAS. The journal records that inode before publication. A forced kill in the two-link window is recovered only if both links are the exact transaction-owned inode; foreign names are retained and fail. Normal existing targets retain same-directory atomic replacement.

Recovery freshness: installation samples current time internally after validating current trusted Git and evidence inputs, uses that time for admission freshness, and records admittedAt in root-private manifest-binding.json and the journal binding before mutation. No argv time exists. Reviewed recovery first requires the supplied exact journal hash and identical root-private binding, exact manifest hash, a present finite admittedAt not in the future, then revalidates the current exact manifest/Git/FILES/profile/evidence bytes using admittedAt as the original admission clock. Targets and target metadata remain rederived and equal the binding before recovery. Missing/tampered/future admittedAt or evidence already stale at that admission fails; a legitimately admitted pending transaction can recover after its observation TTL has elapsed. This preserves original admission proof while all current source/manifest/foreign-inode checks still run. Legacy journals without admittedAt cannot pass production recovery. Terminal outputs remain historical ready=false states.

Additional synthetic subcases verify successful recovery two hours after a valid one-hour admission, receipt rejection at current stale time, journal-time tampering against its private binding, missing time, future time, and evidence already expired at the stored admission time. All rejected cases leave the journal and installed profile unchanged. These local clock fixtures are import-only and do not expose a production clock override.

## Automatic preparation software closure

New canonical tools declare `/var/lib/workspacex-cn/auto-preparation-tools/<SHA>`.
Historical exact Git tools can retain their declared legacy root; the transaction
requires the selected root to equal that exact identity source's AST contract,
in addition to fixed-prefix and protected-parent checks. It does not rewrite old
profiles or relax root trust for a runner-owned legacy parent.

`INSTALL_MODES` in the exact Git `cn-build-tool-identity.py` is the static metadata
single source. Only0700/0755 overrides on installed FILES members are admitted;
absent overrides keep historical target0700/source-only0600. Public drift-checked
scripts use0755, while maintenance hold, recovery and automatic provider helpers
retain0700. Producer, package precheck and transaction derive the same modes;
a manifest cannot choose a different mode. Mode-only changes participate in CAS,
journal, rollback and readback, including restrictive umask077.

The current closure adds the automatic host helpers and bounded runtime source
imports, including only already-existing verify/export bin names. No sudo rule,
credential, environment policy or stable-secret modification is added. See
`docs/evidence/cn-auto-release-5910/canonical-auto-tool-install-contract.md` for
scope, current size bounds and executed regression evidence. The package remains
review-only until actual complete Git, fresh inventory/provider evidence and the
existing root installation operation satisfy their independent checks.
