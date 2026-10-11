# Fixed request driver: code and validation boundary

The fixed driver consumes one separately approved root-owned release request. It derives canonical stage packages from actual preceding receipts. The runner supplies only `status|run|reconcile` and the request's raw SHA-256. `release-cn-fixed.yml` uses the existing production concurrency group and protected environment. This source change does not install the wrapper, authorize a release, or execute a production mutation.

## Normal sequence

1. Check the complete approved code, observer and runtime capability closure before producing a mutation package. Preserve `sourceRevision`, `baselineRevision`, `controlRevision`, `publicationAttemptId`, runtime `attemptId`, `requestedAt`, and `deadlineAt`.
2. Generate and consume the original candidate ZIP/proof objects. Generate the original publication chunks; durably journal each single attempt, run them in order, then canonical check-plan and publish.
3. Verify the exact publication receipt, hold admission, stop and session-zero evidence. Generate the original host backup and exact RDS backup-job observer. No SQL changes does not waive backup: API startup can delete old logs, seed data and resume workers.
4. Generate the exact-five runtime switch. `acceptance` is held **health/read-only status**, not six successful business journeys.
5. Return `WAITING_FOR_WRITER_APPROVAL` when no separate A5 approval exists. An approved root pointer binds the exact switch, held-health, hold generation, user authorization evidence and scoped test data. Only that approval permits clear. It does not reset the original deadline.
6. After actual clear, execute A6's canonical six journeys once and observe stability. Readback checks the saved run IDs and current runtime/hold provenance without login or repeat write journeys. A6 failure retains evidence; the driver does not automatically retry business writes or roll back data.

Stage generation uses its own durable intent. A partial package is `GENERATION_UNKNOWN_REPAIR_REQUIRED`, not permission to generate a different request. The driver lock coordinates the loop; original entry and canonical runtime locks retain their separate responsibilities. It never holds the entry lock while calling `entry()` recursively.

## Raw receipt interfaces corrected during integration

- Entry supplies a decoded predecessor object, while RDS/business adapters accept its canonical raw SHA. The fixed contract converts the interface and maps verified RDS results to entry's strict boolean/terminal shape.
- The consume observer source pin is distinct from the generated `observe.sh` wrapper pin.
- Publication action output is `CN_CANDIDATE_PUBLISHED=` followed by the original `published.json` and one additional newline. Runtime binding consumes the original JSON bytes. The journal verifies the exact extraction against independent publication observation, including the reconcile shape; it never reserializes provider evidence.
- Historical receipts carry a root-owned admission witness bound to original action, observer, authorization and verifier hashes. Advancing state may legitimately clear an old hold; historical validation does not rerun that old live probe. Current-stage observers still run and can fail.
- RDS `DescribeBackupTasks` links the requested job to a finished `BackupId`. Its original `CreateBackup` intent time and exact stop receipt hash preserve current-epoch evidence when the provider reports only minute/second precision. Provider timestamps are never rewritten. The legacy precise-time comparison remains for existing receipts.
- Verification finishing after the original deadline cannot produce a successful normal completion receipt. Explicit read-only reconciliation and separately scoped recovery do not create a new normal release clock.

## Installation and testing still required

`cn-release-orchestrate.py` emits an exact code inventory, wrapper and directory proposal. All target old-state CAS checks, root ownership, cgroup installation, SDK/runtime closures and permission evidence require review before installation. A runner cannot write approvals or replace the fixed code. No IAM changes are performed by this code. Exact RDS actions are `CreateBackup`, `DescribeBackups`, and `DescribeBackupTasks` for the approved Shanghai DB; actual grants must be verified separately.

The final populated approval must fit the entry's 65,536-byte limit, including SDK pins. A small fixture does not prove that the installed SDK manifest will fit. The installation proposal explicitly marks this measurement unverified until the exact installation closure is selected.

Local tests distinguish package/contract routing, actual canonical materialization, provider fixtures and actual local Chromium/TLS journeys. They are not a production E2E result. The new exact head must pass Linux cgroup and browser CI. Recovery to baseline additionally needs its separately approved clear and business capability. The normal router currently blocks with `RECOVERY_TERMINAL_CAPABILITY_MISSING` before mutation because no fixed pre-recovery observer proves an uncertain Docker/provider operation safe to recover. Baseline clear and browser adapters do not establish that proof. After an A6 failure, writers may already be resumed; a held-only rollback is insufficient. This remains an implementation blocker, not a passed E2E test.

Measured build + Hong Kong transfer/readback + Shanghai consume took **440 + 517 + 530 = 1,487 seconds (24m47s)**. ACR publish, backup, switch, A5 approval and A6 were not included. This leaves 313 seconds of a 30-minute request budget; no full-chain 30-minute result is established. Prepared activation must report both full request lead time and activation time. Pure Pages is a separate path; web-only can omit backend backup only after proving no backend recreation and compatibility, not merely because a diff has no SQL.

### RDS SDK manifest reference

The RDS configuration pins `sdkManifestSha256` instead of embedding `sdkFiles`
in the 65,536-byte root release approval. The manifest path is fixed at
`/etc/workspacex-cn/rds-sdk-manifest.json`; its exact schema is
`{kind: "cn-rds-sdk-manifest-v1", sdkRoot: "/usr/local/lib/workspacex-cn/rds-sdk", filesSha256: {...}}`.
The private manifest is bounded to 1 MiB and hash-verified before parsing.
The complete installed SDK inventory is still verified before imports: every
file hash, no extra/missing file, root ownership/private file modes, safe
parents, and no symlink. Inline maps are rejected. This does not grant IAM
permissions or prove an SDK is installed. The actual Linux inventory and final
serialized approval size must be measured before installation/admission.
