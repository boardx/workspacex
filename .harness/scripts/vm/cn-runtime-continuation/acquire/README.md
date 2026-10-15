# Offline acquisition and publication templates

Only `scripts/cn-release-continuation-acquire.py` is a CLI. It reads root-owned
`/etc/workspacex-cn/continuation-approvals/<request-sha256>.json` using the existing
private approval reader. No caller-selected approval directory or approval flag
exists. No file here runs a cloud operation during generation.

The request fields are `schemaVersion: 1`, `phase: consume|publication`, exact
`sourceRevision`, `controlRevision`, `attemptId`, `repositoryId`, `runId`,
`runAttempt`, `producerWorkflowSha256`, original `requestedAt`, `deadlineAt`,
`inputs`, `release`, and `launcher`. Publication also requires `publicationCapability: {issuedAt, expiresAt}`. The original window must be at most 30
minutes. Consume revalidation must cover its full execution deadline. Publication
capability is separately bounded to 30 minutes, starts no earlier than the original
request, and must be covered by the unmodified proof/policy expiry. The root
approval request hash binds this complete capability object. Its later expiry
does not extend the original execution deadline. `inputs` maps names to exact
raw SHA256 values; files are supplied as `<name>.json`. Consume requires plan,
set, proof and policy; publication additionally requires tools, canonical,
provider, redis and binaries. Every file is limited to 1 MiB.

The protected approval has kind `cn-continuation-acquire-approval-v1`, the raw
`requestSha256`, `issuedAt`, `expiresAt`, and `templateFiles` mapping these six
names to exact SHA256: consumer.py, consume-launcher.py,
materialize-publication.py, stage-runtime.py, transport-runtime.py, deadline-runtime.py. Approval installation is a separate
reviewed operation. A generated publisher approval is derived only after this
protected request is verified; it is not a new approval source.

The launcher object has `sdkSha256` and `code` (the eleven pinned original
launcher/SDK/admission dependencies). All code hashes must equal exact Git bytes
at the approved control. Generated runtime verifies installed owner, mode, SDK,
and code bytes again before calling the GET-only consumer under its original
Linux supervisor. The generated consumer uses the original canonical revalidation
and bundle verifier and promotes with the original lock/no-replace semantics.

Publication reuses the original canonical intent, host approval, immutable
provider, Redis, and tool validation. Its generated stage, check-plan and publish
commands carry the original execution deadline in a guard around every action.
The host publication approval retains its separate capability expiry: the existing
canonical 20-minute capability validity requirement remains satisfied even when
execution has only 843 seconds left. Every generated Cloud Assistant Timeout is
clamped to the original remaining time; the guard recalculates the smaller budget
at actual start and stops awaiting the child at that deadline. No clock resets.

The v3 `stage-order.json` is an exact, ordered manifest: contiguous chunk actions,
one assemble, check-plan, then publish. Each step pins the parameters raw hash.
`validate_order` rejects missing, repeated, reordered or tampered artifacts. The
transport requires contiguous persisted chunks and writes a durable assemble
intent before executing the verified complete stage; unknown acknowledgements
must be reconciled, never retried. It preserves root-only directories and private
files, exact size/hash checks, bounded decompression and no-overwrite creation.

The local deadline guard is defense in depth, not proof of stopping daemon or
provider work. On timeout/nonzero/lost acknowledgement it emits
`UNKNOWN_RECONCILE_NO_RETRY`, `externalWritesStopped: false`, and requires an
independent observer. Whole-operation containment belongs to the reviewed outer
entry/cgroup. Every action, including an exit-zero action, still needs independent
observer reconciliation before the single executor advances the manifest. No
automatic retry or rollback authority is created by a timeout. Binary evidence references inside the pinned binaries input remain
required and are checked by exact hash.

`provenance.json` records hashes of the pre-parameterization scripts. Generic
changes remove per-release source/control/run/attempt constants, retain fixed
Shanghai target and approved HK bucket, and constrain both execution and separate capability windows to 30 minutes.
The transport derives from the independently reviewed publication-v2 byte splitter;
continuous ordering and assemble intent are changes requiring fresh review.

## Explicit remaining boundaries

- Canonical `cn_image_candidate.validate_plan` has a reviewed `FORMAL_SOURCES`
  allowlist. A new source outside it is rejected. This binder never bypasses or
  edits that canonical admission rule; an approved producer control must support
  that source first.
- The original consumer limits each ZIP to 2 GiB and all objects to less than
  5 GiB. Oversize inputs fail closed. Changing these limits requires a reviewed
  resource-budget change.
- Installed host capabilities, exact HK object permissions for a new run,
  package approval/install, and one authorized mutation executor are prerequisites.
  The generator does not configure them or report them as ready.
- Tests use synthetic local seven-ZIP archives and real canonical validators;
  they do not prove cloud execution, real image transfer or a 30-minute release.

Regression tests cover exact canonical proof inputs of 17,238 and 70,000 bytes,
all generated commands below 18 KiB, byte-identical reconstruction, omitted and
reordered steps, tampered chunks, one-shot assembly, 957 seconds elapsed plus
843 seconds remaining, expiry before action start, and a daemon stand-in whose
already accepted work completes after the local child is terminated.

## Consumer retention and publisher capacity admission

Before credentials, SDK requests or any OSS GET, the consumer groups fresh
`fstatvfs` free space by root-owned, no-symlink directory `st_dev`. It inspects the
consumer directory, inbox (nearest existing root-owned ancestor if absent),
`/var/tmp`, and `/var/lib/docker`. Inbox promotion must stay on the consumer
filesystem. Nothing is deleted, and free space is not reserved.

`T` is the sum of image sizes returned by the actual canonical `cap.check`;
`Z` is the sum of the nine approved original object byte lengths. Retention is
`R = max(2Z, Z + T + metadataUpperBound)`. The metadata bound includes every
permitted extracted plan/set/fragment, copied bundle metadata, two receipts
(each limited to 64 KiB before writing), and 128 filesystem allocation units
for directories and per-file rounding. Extraction and accounting share the same
named metadata size limits; ZIP/object limits remain unchanged.

Publisher spool and Docker thresholds are compiled from the exact pinned
`cn_candidate_host.py` AST. The compiler verifies the canonical total assignment,
one guard for each exact path/code, and the reviewed multiplier/add-margin shape.
No Python expression is evaluated. The current compiler supports multiplier 4;
any coefficient or shape change, duplicate guard, or total reassignment fails
closed and requires adapter review. Runtime thresholds use the extracted values
and the validated plan's actual `storageMarginBytes`, not a hardcoded margin.

For each device, required free bytes are the maximum of the applicable consumer
`R + margin`, publisher spool threshold plus `R` if it shares the consumer device,
and publisher Docker threshold plus `R` if it shares the consumer device. The
publisher's two original checks on one device use the same post-retention free
space; they are not mechanically counted twice. Different devices are evaluated
independently. Each evidence row reports `consumerRetained`, `publisherSpool`,
`publisherDocker`, `required`, and `free`, with margin and canonical host SHA.

An insufficient-space response reports `CAPACITY_REJECTED`, `ossGets: 0`, and
these sanitized numbers. The launcher exits nonzero after printing that response.
This establishes future compatibility with the publisher's existing capacity
checks under the observed free space, not a measured absolute peak for the full
release. Concurrent disk usage, backups and later runtime phases retain their
own fresh checks. Tests include the observed 18.8659 GB counterexample against
17.450958848 GB of publisher threshold plus retained bytes, exact byte boundaries,
separate filesystems, compressed ZIPs smaller than TARs, changed plan margin,
formula drift and rejection before any SDK import/GET.

### Explicit publication intent version

A root-approved publication request may select `publicationIntentVersion: 3`.
The materializer passes that exact request-bound selection to the reviewed
decision and emits the existing canonical v3 intent with the publisher's fixed
`source-attempt-v1` policy. It never accepts caller tag or repository text.
An absent selection retains historical v2; explicit integer 2 is also accepted.
Consume requests reject this field. Booleans and unknown versions are rejected.

The candidate plan, set, proof and producer control revision remain unchanged.
Generator/template bytes are separately pinned by materialization approval; a
version selection requires a new exact request approval and matching template
hashes. This source change is not part of an already built control package.
The fixed installed MVP entry still requires its reviewed installed closure;
a new generator cannot be mixed into that package or reported as installed.
Using an existing standalone materialization CLI requires a separate concrete
approval for its exact code, template bytes and invocation after host checks.
This change neither rebuilds candidates nor authorizes installation/publication.

For a candidate already produced with control AA, that plan's control revision
must remain AA: independently approved generator/template bytes do not re-sign
its identity. A first publication may still use historical v2 only if a fresh
immutable registry readback proves the exact source-only target tags are absent
or already contain the same approved image. Absence is never assumed. That
one-time v2 success would not fix later rebuild collisions. Permanent v3 source
support, the current round's approved execution choice, and actual installed
production code are three distinct states.
