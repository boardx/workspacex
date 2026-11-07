# CN release qualification #6150

Requested behavior: reuse a successful develop-built tag on CN and permit manual
CN selected-branch builds without a tag. PR #6153 implements the workflow modes.
This directory retains the exact operational proposal; it is not an installed
entrypoint, sudo permission, approved-success receipt, or automatic SQL policy.

## Frozen existing artifact

- tag: `41502993193-1`
- source: `151526a4f8dea1ad781d709ab8e3357f52714a96`
- failed CN attempt: `attempt-176a7907791b408190dc1501e3ba35fc`
- observed full CN ledger:438; candidate adds11 exact SQL files.
- running prior tag:`41248889927-1`, source:`e44119db91e9539418ad605ca6aaef2c155d0116`.

The old installed schema writer/verifier are fixed to that prior tag and an
expired capability. Reusing the new artifact was routed to this obsolete adapter.
No new production migration or image switch has been accepted in this work.

`reconcile-prewrite.py` targets only that failed intent. It holds the canonical
lock and verifies wrapper/closure pins, fixed-tag refusal, no writer reservation
or writer-stage artifacts, unchanged current pointer, complete baseline ledger
and actual old running images. It records and fsyncs the evidence before archiving
pending.json. It neither deletes history nor executes DDL or container mutation.
Independent review requested required-import closure checks and directory fsync;
both were added. Any drift refuses the reconciliation.

`build-tools.py --output <new-directory>` compiles a separate fixed release
closure from frozen `5219b7dd81eb24f9346e67d12de9f716f14ab05a` tool sources and
reviewed migration bytes from the artifact source. It does not connect to hosts,
install tools, replace historical policies, or grant deployment permission.
It retains all exact source/tag/SQL/lock/baseline checks and a separate policy path
`/etc/workspacex-image-release/cn-reviewed-tag-release-6150.json`.
The new profile is explicitly **first BASELINE only**; COMPLETE is refused before
reservation/hold. A later activation failure retains pending evidence and requires
separate actual reconciliation, never SQL replay or an improvised flag change.

The pinned backup helper adds mandatory stopped-writer, source-faithful owner/ACL
restore rehearsal before production SQL: original encrypted archive, password-free
role/catalog capture, a nonroot network-none bounded clone, original ownership and
ACL comparison, exact SQL as the source migration role, app_rw transaction rollback,
clone cleanup and unchanged live source readback. The verifier consumes the original
hash-bound receipts. Legacy `restoreNotPerformed=true` remains conservative about
full recovery acceptance; the new owner/ACL/SQL proof states its own actual scope.
Role settings and complete end-to-end disaster recovery remain unqualified.

## Verification boundary

Local regression:54 registry tests,10 workflow/tag-reuse tests, release strict tsc
and25 affected typecheck/lint tasks passed. Independent code review accepted the
workflow changes. First build-only CN dispatch:41521008088, sourcefe961032e;
all five image builds and the immutable manifest succeeded. Downloaded manifest
readback bound tag41521008088-1 to sourcefe961032e and all five registry digests.
Deployment was intentionally skipped (build_only); production acceptance is outstanding.

After the user unlocked the Mac, the exact pre-writer failure was reconciled on
CN with `databaseWrites=false`. The pending intent was archived only after full
ledger/runtime/closure checks and fsynced evidence. The independently reviewed
23-file closure was installed in a separate root-private directory; the original
configuration was retained before binding the new writer/verifier. Read-only input
preparation succeeded for438 baseline entries and11 exact additions. No production
activation has been accepted yet.

The first actual dispatch41528359067 was rejected by the production-cn environment
branch rule before any runner/step was assigned. This is not a server migration
failure. Dispatch41528982696 uses the allowed develop workflow and the same immutable
tag; its actual production outcome remains outstanding.

Operational proposal regression: five offline tests passed, covering exact SQL
byte/extra-file rejection, actual JavaScript driver source/tag binding, and COMPLETE
state refusal before reservation/hold/stop/replay; original-proof archive tampering
and semantic failed-restore rejection. Bundle manifest SHA-256:
`c4b65c012f5db61042ece8b18f500985512765ec0f296ceb91071b9aea47e3e1`.

The compiler expands only the CLOSURE assignment; an AST regression preserves
both one-argument old-probe paths. Independent review reproduced all five tests.
The simulation ran1256 cases without failure but detected Next.js adding its
existing chat-read fixture dist types to the release config. The release include
now declares that build output explicitly so builds do not mutate tracked source.
