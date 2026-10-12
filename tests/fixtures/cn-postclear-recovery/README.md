# T24 isolated post-clear recovery fixture

The production entry points do not import this directory. No production recovery
policy, unit, permission or database configuration is installed or changed.

`driver.ts` obtains the real OriginalPlanAuthority capability through the existing
test file reader, executes createARouteFactory/runARouteMaintenanceRelease, and
injects a failure after opening. Its persistent Python actor uses the original
HoldStore on disposable private files, a real retained flock, and the original
RetainedCandidateActor/CandidateHostTransport/CandidateWriterAdapter code. G2 is
created by the original catch path, never supplied by JSON. A WeakMap context
expires when that callback returns. Every continuation guard verifies the actual
context, original authority, held lock, original actor blocked readback and G2.

The provider/Docker/process observations and initial migration/epoch/public
receipts are explicit source-owned fixtures. They do not prove real cloud writer
identity, initial migration correctness, TLS or browser acceptance. The scenario
specifically tests the original post-clear control flow and data preservation.
No-op prehold/migration fixture producers must not be described as those stages
having passed production validation.

`recovery.ts` claims the recovery once before capture, requires three fresh G2
snapshots bound to post-clear writes, restores each to a separate fixed target,
checks original catalog facts and complete fixture row-data hashes, and stays held. Unknown capture or
restore results leave the claim and cannot repeat the operation. Partial targets
remain disposable, while the source databases retain the new writes.

`postgres.ts` is the real SQL data plane. The Linux harness creates a new non-root
PostgreSQL cluster for each of four scenarios (success, old epoch, unknown writer,
partial restore). Only loopback is enabled. It creates synthetic rows, writes a
new row as the opened lane role, executes the original login CAS SQL to close that
role, verifies a new lane connection cannot insert, dumps all three source DBs,
restores into three new databases and compares the full small fixture schema,
constraints, indexes, all rows and post-clear row hashes. It also rechecks source
stability across the complete capture. It does not claim arbitrary application
schema/object-store coverage or successful production recovery.

The catalog implementation uses the original full facts algorithm (details below),
without the production provider/capture binding protocol. The partial
restore scenario loses the acknowledgement after the second real pg_restore has
completed and its data has been read back, then refuses any second dispatch.
Linux error output contains only fixed codes, byte counts and hashes, no stderr text.

Local evidence: eight tests pass through the original control/catch/close-only chain
with fixture data ports. Real PostgreSQL requires Linux and has **not run yet**.
The Mac harness fails with LINUX_ROOT_REQUIRED (not a skip/pass). Local Docker
inspection was denied by its socket permissions; no container was started.

Commands:

```
CN_POSTCLEAR_PYTHON=/absolute/python3 node --import tsx --test tests/fixtures/cn-postclear-recovery/recovery_test.ts
CN_API_STARTUP_NODE=/absolute/node python3 -B tests/cn_release_postclear_recovery_linux.py
```

The Linux command requires the existing simulation's root-owned outer cgroup
supervisor, installed PostgreSQL binaries and postgres account. Its child processes
inherit that containment. Four scenarios have bounded individual commands and
exact pg_ctl/data-directory cleanup; the outer simulation must enforce the total
suite budget and final descendant cleanup. A live systemd service is not involved.

## Original catalog fidelity extension

`catalog.ts` now invokes the original `cn_restore_catalog.cjs` re-export of
`cn-production-recovery-catalog.cjs.collectFacts` and original `canonical`. The
production module change only exposes the existing pure read collector; query,
role-closure, capture, compare, port and provider checks are unchanged. The local
adapter owns an actual repeatable-read read-only PG transaction and checks actual
socket port/address, SQL database/user/read-only identity and cluster identifier.
All original catalog categories (ACL, roles/membership closure, functions, triggers,
RLS, sequences, AGE metadata and others) are hashed; source and isolated clone
facts must match. Fixture row-data checks remain separate.

The original production `capture`/`compare` binding protocol is **not** executed:
it requires port 5432 and independent provider instances, while this disposable
fixture uses a random port and separate databases within one isolated cluster.
Catalog database socket identity is actually checked; candidate container socket
witnesses remain synthetic as described above, and provider identity is not claimed. Output states
`originalCatalogFactsVerified: true`, `originalCaptureProtocolExecuted: false`,
`providerBindingVerified: false` after the algorithm succeeds. No production provider or capture-protocol acceptance is claimed.

Five extra local tests exercise the actual algorithm with an explicit mock PG
client, full query/role coverage, missing ACL/function comparison rejection, query
failure rollback, real-socket binding rejection, and unchanged production gates.
These are not real PostgreSQL tests. Run `catalog_test.ts` alongside
`recovery_test.ts`; real Linux execution is still required.
# Socket fixture endpoint fidelity

Run 38260954556 rejected `ACTOR_CANDIDATE_SOCKET_OWNER_NOT_PROVEN` before
the post-clear write. The original unit-test seal hard-coded `10.0.0.1:5432`,
while this fixture's real PostgreSQL peer is loopback with a random port and
the original probe's `inet` text representation. `isolated_socket_seal` now
binds only the synthetic remote endpoint to the separately validated local
cluster peer. The original socket ownership verifier is unchanged. Regression
checks reject the previous endpoint, wrong port, wrong cgroup and peer drift.
Socket/process/container witnesses remain explicit fixtures: this fix does not
prove real container socket ownership. Real Linux recovery must run again.
