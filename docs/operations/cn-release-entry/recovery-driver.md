# Durable baseline recovery driver

This is a separately approved root CLI. It is not part of an automatic failed
release retry, does not grant new cloud access, and does not restore database
contents or deleted logs. No production installation/execution is claimed.

```
cn-release-recovery-driver.py run|status|reconcile|readback|prepare-seal|seal|seal-reconcile RELEASE_SHA FRESH_RECOVERY_SHA
```

The fixed release approval pins the complete installed code closure. The fresh
recovery approval must match the fixed `by-failed-request/<failedRequestSHA>.json`
pointer. Original source/baseline/attempt/requestedAt/deadlineAt remain unchanged;
only the separately approved recovery window governs recovery mutations. Its
maximum is 30 minutes. There is no caller-supplied command, path or environment.

## Preparation

The existing terminal delegation tool must first materialize the approved
`terminal/recovery-<freshSHA>/{recovery-binding.json,recovery-reconciliation.json,provenance.json}`.
The dedicated driver independently rechecks actual recovery admission, runtime
and binding hashes, and stages these exact files under canonical `release.lock`.
Existing identical staged files can be read back; different bytes are rejected.
No runtime action occurs before its durable intent.

The installation proposal must include driver/contract and all business/writer/
admission dependencies, fixed root wrapper, root-private approval directories,
and the existing global entry lock/cgroup-v2 kernel kill domain. Runtime code
is taken only from the exact approved runtime root. Do not point at a caller's
checkout or a user-writable browser/SDK tree.

## Three durable stages

1. `runtime`: original reviewed rollback or abort-original operation, retaining
   the same hold, followed by independent old-five-image/config/health readback.
2. `clear`: only after a separate fresh baseline writer-resume approval exists.
   Before that approval the result is `WAITING_FOR_BASELINE_WRITER_APPROVAL`,
   with no clear intent. The root operator records fresh `baseline-health`
   and original hold/test-scope/user-authorization evidence using the existing
   fixed business/recovery-writer contract. The driver does not mint approval.
3. `business`: actual canonical six old-version journeys exactly once, followed
   by independent readback of their original run IDs, clear lineage and exact
   current baseline inventory. Readback does not log in or replay writes.

The driver serializes all stages with global `continuation/entry.lock`; each
actual runtime/writer/business helper takes canonical `release.lock` itself.
Each mutation uses the original entry process runner/cgroup and fsynced intent,
PID/isolation journal, evidence and receipt. An action with an intent but no
accepted receipt is UNKNOWN. `run` never resends it. `reconcile` checks the
original process domain is terminal, performs only an independent readback,
and resolves at most one attempted stage; it does not start the next stage.
A missing PID journal or missing canonical action result remains unknown.

State is fixed under
`/var/lib/workspacex-cn/release-generated/<releaseSHA>/recovery-driver-<freshSHA>/`.
No new broad mutable root is introduced. Replacing a hold or recovery approval
is not an implicit retry permission; exact original generation and pointer
checks remain mandatory.

## Final entry seal

The existing entry `recover` contract requires all three terminal truths:
`baselineBusinessAccepted`, `holdCleared`, `externalWritesTerminal`. A runtime
rollback's `holdRetained` result cannot satisfy it.

After actual completed checkpoints and live business/clear readback,
`prepare-seal` creates a hash-addressed, immutable recovery package whose action
and observer are both the same fixed **read-only** final contract. Its verifier
checks the exact generated package, original failed request/predecessor, original
release identity and fresh window, plus independent current old-business and
clear evidence. The driver releases `entry.lock` before `seal` invokes the original entry `recover` with the exact prepared
request and attempt. Entry acquires its own lock and rechecks identity/owner and
actual readback. The driver never calls entry while holding the same lock.
`seal-reconcile` only invokes original `reconcile-recovery` for an already
existing package/intent; it may inspect expired authority without authorizing
any runtime, clear or browser mutation. Entry retains its original exclusive
execution and journal guarantees. Preparing/running this seal requires an
unexpired fresh recovery window; no code silently extends it.

## Tests and limits

Fifteen offline tests exercise real private files and real subprocesses,
wait/resume without rerunning runtime, UNKNOWN clear/business no replay,
missing PID/changed checkpoint/expiry rejection, actual writer output consumed
by the original baseline reader, fixed argv compatibility, and the real entry's
failed-action → generated read-only recovery package → completed seal path.
That entry test uses an explicitly identified read-only contract fixture;
production contract pin/live-result behavior is tested separately. A real
POSIX flock test verifies the CLI releases the driver lock before invoking the
original entry and propagates a rechecked owner-race failure. Existing
actual Chromium localhost candidate/baseline tests validate the canonical six
browser paths, not live cloud providers. These tests do not establish a
production Docker/RDS recovery or target cgroup/credential installation.
