# Source-owned held candidate expected authority

`held_candidate_expected.cjs` exports
`createQualifiedExpectedVerifier({profile, readProtected})`. Its returned function
is synchronous `verifyQualifiedExpected(expectedRef, expected) -> true` or throws.
The root compiled consumer supplies the protected reader; private JSON never
selects a callback, executable, SQL, connection or model operation.

Root profile `heldCandidateExpected` has exact fields `expected`, `aggregate`,
`qualification`, `qualificationInput`, `sourcePolicy`, `migrationCompletion`,
`appSourceManifest`, `aggregatePolicy`, `sourcePath`, `sha256`. References have
exact `{path, sha256}`. Every read is checked against the raw byte hash. The
sourcePath is `.harness/scripts/vm/held_candidate_expected.cjs` and source hash
must match `profile.filesSha256`. Root loading must independently verify the
loaded module descriptor against that hash. `qualification` points to the actual
schema-2 qualifier's `qualified-current-epoch/epoch.json`, not a passed boolean.

The separate `aggregatePolicy` is root approved and does not extend the existing
epoch policy's exact invocation closure. Its schema is:

```text
schemaVersion: 1
kind: source-approved-held-readback-policy
binding: exact schema-2 current epoch binding
producer: {sourcePath, source, executable, namespaces}
invocation: raw reference to schema-2 actual invocation
isolatedStageReceipts: map of actual isolated stage raw references
```

Producer sourcePath is fixed to
`.harness/scripts/vm/held_candidate_expected_producer.cjs`; source must match the
root profile files hash. Invocation must bind producer source/executable/
namespaces, exact current epoch binding, actual output rawref and all input
rawrefs, successful exit, joined owned children and process/start identity.

The aggregate has exact `schemaVersion:1`,
`kind:qualified-held-readback-aggregate`, `binding`, `qualification`,
`migrationCompletion`, `appSourceManifest`, `targets`. Each of the three database
arrays contains `{targetId,keyValues,factsRef,stageReceipt}`. A factsRef is a raw
JSON fact array in the existing held query representation. It must appear both
in the approved actual isolated stage's proofRefs and the aggregate invocation's
inputs. Every stage binds APP 9b and the exact isolated target instance.

The checker derives count/digest from those actual arrays and compares every
expected target. It requires all nine source query targets, nonempty schema and
permission facts, each source bootstrap column, agent and memory initialization
catalog/extensions and exactly three source-derived system-agent seed joins in
one organization. Stable names/providers are parsed from hash-pinned fixed APP
source refs, including the three repository templates and bootstrap column
source. Expected data cannot supply replacements. Completion must be fresh,
fixed APP/BASE/release/attempt/plan bound with nonzero actual applied SQL count
and no pending, unknown or drifted rows.

Missing facts fail closed. The current epoch qualifier does not yet produce the
held aggregate or its facts arrays. Existing isolated stage result wrappers
cannot be renamed as arrays; a source-owned isolated facts producer must expose
the actual matching projections and approved stage lineage. The independent fixed projection producer described below implements that source
collection. Actual production qualification remains unperformed.

Local validation: `node --test .harness/scripts/vm/test_held_candidate_expected.cjs`
passed 4 test groups (including complete successful reference DAG and rehashed
missing seed, empty facts, missing bootstrap columns, provider and database
negative cases), exit 0. `git diff --check` passed. No SQL/network/model/production
operation or commit was performed.

## Actual fixed projection producer (source implemented)

`held_candidate_expected_producer.cjs` now exports async
`collectQualifiedExpected(io)`. Root compiled code supplies these fields:

- `binding`: the exact schema-2 current held epoch and isolated target binding.
- `qualification`, `migrationCompletion`, `appSourceManifest`: protected raw refs.
- `connections`: exact three database map of already-open isolated diagnostic
  control helpers (`client`, `identity()`, `binding`, `identityBinding`,
  `toolRevision`, `transactionStatus`, `mode`). No client constructor is used.
- `roles`: exact database map of approved runtime role names; `orgId`: the actual
  qualified organization identity for three source-derived system agent seeds.
- `providerRefs`: exact database map of protected isolated provider output refs.
  Each output contains `binding`, `observedAt` (fresh within one hour),
  `attribute.Items.DBInstanceAttribute`, `network.DBInstanceNetInfos.DBInstanceNetInfo`.
  The instance ID must equal the isolated target and never production RDS; private
  endpoint IP, port and VPC must match the borrowed diagnostic connection peer.
- `producer`: fixed `sourcePath`, actual source rawref, actual Node executable
  rawref and actual process namespace inode map (`pid`, `mnt`, `net`). Self source
  and executable bytes are independently checked against the running process.
- `readProtected(ref)` and `writeProtected(path,bytes)`: root compiled protected
  IO; the latter returns exact rawref and must refuse replacement in production.

The producer uses the existing source-owned SQL constants and `sourceRoleSelect`
export from `held_candidate_queries.cjs`. Three actual read-only transactions
collect the nine fixed target classes (eleven concrete rows because the API seed
class has three templates). Every transaction rolls back and rechecks the retained
connection. Failed/lost BEGIN, queries or rollback cannot produce aggregate output.
Actual fact arrays become separate protected raw files. New receipts use
`schemaVersion:1`, `stage:held-candidate-fixed-projections`, `epochBinding`,
`database`, `connection`, `readOnlyTransaction:true`, `rollbackComplete:true`,
`binding:{candidateSha,targetInstanceId}`, `proofRefs` pointing to those arrays.
This is a new source collector, not an alias for earlier stage wrappers.

Returned evidence contains `aggregate`, `expected`, `invocation`,
`isolatedStageReceipts`, `producer`, `ready:false`,
`productionAvailabilityProven:false`. The invocation records actual PID, start
clock and namespaces read from `/proc`, exact source/executable, complete inputs,
raw aggregate output, successful return and zero unjoined owned children (the
producer starts no children). Root must separately approve and pin aggregatePolicy;
that policy is never inferred from a local fixture or the producer's return value.

Updated validation: `node --test .harness/scripts/vm/test_held_candidate_expected_producer.cjs`
passes six groups, including end-to-end source collector → aggregate → checker
success with local borrowed-client mocks, plus production instance/socket rejection
before SQL and read-only, seed provider, lost BEGIN and rollback negatives. Actual
cloud SQL, qualification replay, production installation and activation remain
unperformed and require their own authorization.

Three seed compatibility verification: all three seed rows intentionally use
source-owned `api-system-agent` plus distinct source-derived `keyValues`.
Uniqueness is the composite target ID and canonical key values, matching the
actual held query helper and stage action. The end-to-end mock test now feeds
producer expected data through the real `readHeldCandidate` for all three
probes in all three databases. All three source seed SELECTs execute in both
producer and consumer (six total); missing or duplicate source seed keys reject.
The actual helper's `auth_bootstrap_state` target matches the APP bootstrap
column mapping. Updated six-group command passes in 2.81 seconds.
