# Fixed BC cloud-call phase adapter

This is a development contract for PR #5810, not an execution approval. The original BC build
38852606085 attempt 2 succeeded, but its candidate window expired at
2026-10-17T11:48:36.413148Z. Production remains NO-GO. No candidate or deadline is renewed here.
The [seven-step plan](plan.md) remains the production status authority.

## Reuse and explicit calls

The existing immutable root driver owns A0–A6, canonical publication, image-only Compose, hold,
backup, switch, business observation and durable per-stage receipts. New library
`scripts/fixed_cn_phases.py` calls the existing `fixed_cn_remote.EcsRpc` capability; it neither
acquires credentials nor exposes dispatch through the PR workflow. No Mac runtime is used.

| Python API | Required inputs | Boundary/result |
|---|---|---|
| `begin(packet, plan_raw, plan_sha, release_raw, release_sha, provenance_raw, migration_raw, rpc, output, authorization_evidence_raw=...)` | Independently approved original bytes; existing authenticated RPC; pinned installed tool; private durable journal | Exactly one `RunCommand`. Verified driver exit 2 at A3/A4 or held-health produces immutable `pause.json`; no automatic continuation |
| `begin(..., previous_pause=(directory, pause_sha))` | Actual prior A3/A4 pause at `switch-stage` (12 completed stages) or `switch` (13), and new packet issued after its provider finish, same principal/root/candidate/backup epoch | One explicit continuation; waits for A5 after actual switch/held-health |
| `recover(packet, ..., rpc, output, previous_pause=..., max_seconds=30)` | Existing persisted approval, intent and acknowledged invocation | Read-only provider queries; restores exact missing failed-output/failed-command/pause bytes; never submits or advances |
| `resume(packets, preparation, ..., writer_raw, writer_sha, ..., rpc, output, authorization_evidence_raw=...)` | Actual held-health pause, independently approved actual-hash writer bytes, three fresh approved packets | Same root chain continues; canonical A6 witness plus two separate read-only invocations returning identical original receipt bytes |

`packet` is `(original_approved_bytes, sha256)`; `preparation` is `(existing_pause_directory,
independent_pause_sha256)`. Resume packets are root release-run sequence 0, business-readback
sequence 1 and business-readback sequence 2. Readback approvals use the existing `@previous`
protocol, binding actual preceding receipts without inventing future hashes. The root continuation
packet binds the actual pause SHA. All retain the original source/control/build/candidate/window.

The independently approved root object must add:

- `safetyGates`: kind `cn-a3-a4-policy-v1`, exactly four `sqlFiles` path→source SHA256 pins,
  an exact `isolatedDatabaseId` distinct from production, and `explicitWriterRequired: true`.
- `toolRevision`: separately verified installed tool revision (40 hex); never inferred from the
  application source or producer control SHA. The runner codeFiles closure pins seven orchestration
  modules, and the existing root closure pins the complete installed implementation.
- `orchestrationJournalRoot`: existing private, current-executor-owned mode-0700 durable cloud
  directory. The offline proposal generator accepts only
  `/var/lib/workspacex-cn/release-orchestration/<original-attemptId>`; fixture APIs use temporary
  directories. Each call's output must be exactly `<journal-root>/<transport-approval-sha256>`.
  Changing output paths cannot resend an uncertain packet. This source does not create root/journal
  permissions, install tools, supply identity or modify IAM/OIDC/runner configuration.

`cn-release-approval-plan.py` includes these fields only as explicit inputs and validates policy,
fixed journal shape, tool revision and complete closure. BC proposals missing them are rejected.
Its output remains `approvalGranted=false`, `installationReady=false`, `cloudCalls=0`.
No checked-in historical approval/plan hashes are refreshed.

## A3/A4 protected independent evidence

Before `switch-stage` **and** actual `switch`, the BC router consumes:

1. Original host and RDS backup observations from the existing driver, matching hold generation,
   source database, attempt and successful backup. Their `restoreTested` flags remain false;
   no backup receipt is relabeled as a restore test.
2. Root-owned protected selector
   `/etc/workspacex-cn/release-safety-approvals/by-release/<release-sha>.json`, containing only
   `approvalSha256`, and the hash-addressed approved envelope alongside it.
3. Hash-addressed restore and SQL observation JSON under
   `/var/lib/workspacex-cn/release-safety-evidence/<sha>.json`, with all referenced nonempty raw
   authorization/provider/restore-readback/schema/four-SQL proof bytes stored as `<sha>.raw`.
   Reads use the existing protected no-follow reader. Missing or changed objects fail closed.

Envelope kind is `cn-approved-a3-a4-evidence-v1`: exact release/identity/target, issued/expiry inside
original window (at most 30 minutes), restore/SQL receipt SHA256s and independent authorization
proof SHA256. Restore kind is `cn-isolated-restore-observation-v1`: exact original backup byte
hashes/backup ID/hold generation, production source and pinned isolated target, provider proof,
readback proof, actual started/completed timestamps and successful restore/readback outcomes.
SQL kind is `cn-four-sql-compatibility-observation-v1`: production DB and schema inventory,
original migration-diff SHA, exactly four source-pinned files, each compatible/readOnly with raw
proof, and observed time. Backup end ≤ restore start ≤ restore finish ≤ SQL observation ≤ approval
issue. All receipts match original identity/target/hold epoch.

These are normalized, independently approved observer contracts. This increment does **not**
implement or authorize a live restore executor, SQL mutation, independent human approval producer,
or provider-specific parser that proves the meaning of arbitrary raw proof bytes. The protected
approval must attest their authenticity and meaning. Root-owned approved bytes remain the trust
boundary; synthetic fixture flags or caller-supplied files confer no authority. Actual production
capture, review and protected installation remain missing. Unknown SQL compatibility is blocked.

An honestly nonempty migration diff remains rejected by the canonical no-migration route. Four
real SQL files are neither removed, applied nor treated as empty. A migration release requires its
own reviewed route. Missing selector returns `WAITING_FOR_A3_A4_EVIDENCE`, exit 2, before any
switch generation. Revoked/expired/changed evidence cannot be bypassed by a pregenerated package.
Repeated valid admissions recheck live approval/evidence while preserving the first immutable
consumption record; different evidence cannot silently replace it.

## A5, A6 and uncertain outcomes

For fixed BC, no conditional writer approval is auto-materialized. The driver pauses before
clear-hold with actual binding/hold/switch/held-health, backup epoch and consumed A3/A4 pins.
Writer approval must match these actual hashes and be issued after verified provider finish.
Continuation approvals must follow writer issue; changing principal/tool/root/candidate or
refreshing the original clock fails. Completion's protected A3/A4 witness must still match the
held pause before any A6 readback. Canonical A6 validates login, hello/SSE, ASR, GitHub feedback
read, skill/tool and PDF download, distinct owned runs, stable window and original-byte readbacks.
Returned development consumption results explicitly keep `productionAccepted=false`.

A lost submit acknowledgement remains uncertain: there is no automatic replay, cancellation,
new directory retry, recovery execution or independent command search. Reconciliation requires a
persisted known ack. Only terminal exit 2 with original approved-window provider times and exact
checkpoint can produce a pause. Failed-command evidence is never a success receipt. Reconciliation
may restore historical bytes after expiry, but cannot resume an expired candidate or root approval.
A failed or uncertain resume requires independent status review; reusing its packet is rejected.

The PR workflow has only `contents: read`, tests exact PR head on Linux and invokes no production
adapter, secret, dispatch or provider SDK. The Docker fixture remains GitHub-Linux-only; local
HTTP/fake-provider/SQL observations prove contracts, not live cloud access, real SQL compatibility,
restore correctness, business journey success or the 30-minute production target.


### Revocation between staging and switch

A3/A4 evidence can be revoked after `switch-stage` completes. The root then returns
`WAITING_FOR_A3_A4_EVIDENCE` at `switch`, with 13 actual completed stages and no switch intent.
This is a supported pre-switch pause in checkpoint, explicit continuation and read-only recovery;
it is not rewritten as a 12-stage pause. Continuing while evidence remains revoked pauses again.
Only the same valid independently approved evidence, revalidated by the root, can permit switch;
changed immutable evidence fails closed. A fresh transport packet binds the actual pause and
original backup epoch/window. Later A5 still requires actual held hashes and fresh approval.
No automatic approval, replay, backup restart or original-clock refresh is introduced.
`test_actual_root_switch_revocation_pause_recovery_and_explicit_resume` composes the actual root
loop/router checkpoint with phase/RPC save, recover, repeat wait and final explicit A5 continuation.
External stage execution, filesystem protection and live gate observations remain fixture seams.
