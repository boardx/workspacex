# Late candidate staging plan producer

`candidate_plan_producer.py` produces the existing candidate actor envelope exactly:
`{schemaVersion:1,toolRevision,plan,artifact}`. It imports inertly and has no CLI that
opens host sessions or runs stage commands. The app/base remain the fixed 9b25/ba634
revisions. It introduces no shared plan fields.

Inputs are fixed identity/tool/host/epoch/held generation and nine root-private byte
hash references: template, epoch input, epoch collection, epoch manifest, retained runtime seal,
durable completion, live ledger, stage inspection and artifact descriptor. It replays
the existing current-held-epoch evidence producer and compares the output with the
collection bytes. `collectionVerified=true` is not qualification: the existing
`qualified=false` and `ready=false` remain mandatory.

The source-owned retained transport must implement all of these methods:

- `require_lock()` and `observe_hold()` prove the same held generation/identity/host.
- `verify_current_epoch({collection,manifest},binding)` verifies actual scoped recovery and
  current-epoch isolated acceptance; output is the exact fixed binding plus
  `kind=retained-current-epoch-verified`, collection raw hash, epoch manifest raw hash and recovery/acceptance
  evidence hashes. A plan boolean cannot supply this capability.
- `verify_runtime_seal(runtimeRef,binding)` invokes the existing protected runtime
  verifier and returns the verified seal, including six actual retained sessions.
- `observe_retained_sessions(binding)` reads the same control/diagnostic session
  bindings from the retained actor. The producer derives the six held sessions;
  duplicated PIDs, wrong peers, session drift and unsupported roles fail.
- `observe_completion(binding)` supplies the journal-durable exact completion ref
  and live diagnostic-ledger observation. Completion bytes and canonical ledger
  hashes become the existing candidate plan hashes.
- `observe_stage(binding)` collects real Docker inspect and actual Compose hashes
  after an approved stage operation. All candidate/baseline bindings must match,
  with candidate and baseline writers paused or stopped. No stage implementation
  is supplied here; missing source transport is a stable rejection.

The producer verifies artifact bytes, rechecks every input ref, held state and actual
sessions/stage/completion before returning. Failure returns no candidate envelope;
no rollback mutation occurs. The caller retains hold/lock and reconciles uncertain
stage outcomes before retrying.

`write_candidate` permits only the existing exact candidate-plan path, verifies
root-owned protected ancestors and private 0700 parent, and creates 0600 bytes with
O_EXCL/O_NOFOLLOW, file fsync and directory fsync. Existing output is never silently
replaced; a retry needs explicit readback/reconciliation.

Local evidence: nine producer tests and the candidate-series suite pass. Negative
coverage includes absent transport, added qualified flags, collection relabeling,
wrong image/config/Compose identity, running candidate writers, session alias,
unverified retained seal, artifact hash tampering, source-ref changes and late
stage/session/completion races. The output test redirects all filesystem operations
into a temporary directory and proves mode, exclusive create and both fsync calls.

Backlog: production factory must bind these compiled retained operations, invoke
approved stage/capture/recovery transports, then pass the produced exact wrapper
hash to the existing candidate actor. This source package does not execute that
work, qualify a production epoch, install host files, issue SQL or claim READY.

The input binding epoch is the semantic collection identity; the candidate plan epoch
is the immutable factory `held-current-epoch-manifest` raw byte hash. They deliberately
differ and are never replaced by a self-hash. The manifest has the existing strict factory
shape and cannot contain qualified/ready flags. The retained consumer verifies both refs;
missing manifest, wrong raw/proof hash, wrong generation and late byte drift all reject.

Runtime seals use the existing exact `/var/lib/workspacex-cn/runtime/{attempt}/sealed-writer-runtime.json`
path; completion and epoch manifest use their existing exact `/etc/workspacex-cn/`
paths. Foreign paths with otherwise valid data/hash are rejected before reading.

Actual stage evidence uses sanitized inspection with `configSha256` over the full Docker
Config and only Compose identity labels. The producer checks that hash against the
exact writer binding and repeats the trusted source observation; Env contents never
enter the output actor envelope.
