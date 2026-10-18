# Original executor evidence inventory (local snapshot only)

Refs #5813. Second source increment after PR #5815's transport-clock reader.
The remaining implementation gap is provenance, not merely JSON field completeness: a trusted
collector must link actual GitHub request/run/attempt/owner times and cross-host UTC error,
target/scope, independently pinned image/toolkit bytes and canonical root admission, backup and
isolated restore/SQL/runtime evidence, and final real A6 stable samples. No current local tool
can establish that provenance. It requires a reviewed collector through an existing supported
cloud interface; no dispatch action or new installation permission is introduced here.

`scripts/cn-release-evidence-closure.py` reads only supplied local original-format snapshot folders.
It verifies the existing17-stage executor's identity, original intent/receipt/evidence/terminal
observation/admission files plus process/terminal journals and each hash-addressed request package's
manifest/action/observer/verifier/authorization bytes. It never imports package code, executes
commands, reads production paths by default, uses a provider SDK or creates an approval object.
All files are bounded, no-follow regular single-link reads; a second digest pass detects changing
snapshot bytes. Evidence is hash-bound to original request/attempt/stage identity. Admission JSON
must match its original manifest and evidence/observer pins. Empty/missing or SKIPPED/UNKNOWN
terminal records fail closed. A reconciled receipt retains its original action exit code and is
never rewritten as a successful action; canonical root reconciliation is still required.

Output inventories names, sizes and hashes, never raw code, authorization, evidence or process
contents. Even a complete17-stage local inventory reports sourceAuthorityVerified=false,
cloudTerminalityVerified=false, productionAccepted=false and thirtyMinuteProductionProven=false.
It explicitly enumerates unresolved production evidence; CLI always exits2. It is a component
for a later trusted collector, not the collector or complete end-to-end timer itself.

```sh
python3 -B scripts/cn-release-evidence-closure.py \
  --attempt-dir /absolute/private/local-attempt-snapshot \
  --packages-dir /absolute/private/local-request-packages \
  --github-accepted-at <original-UTC> --user-requested-at <original-UTC>
python3 -B -m unittest discover -s tests -p test_cn_release_evidence_closure.py -v
```

12 tests pass locally. They execute harmless actual durable executor subprocesses, including all17
ordered stages in one test, then read205 original files without reexecution. They inject package
tampering, missing process/terminal, wrong request, failed/unknown command, residual group,
stdout/time drift, empty/symlink evidence and mid-collection changes. Filesystem root ownership is
an explicit disposable-subtree test seam, not a production guard change. External action/observer
and verifier bodies are fixture programs: these are not real17 production operations, backup,
restore, migration, six journeys, capacity/stability, remote terminality or30m acceptance.

The previously denied TLS navigation/artifact download/new public issue are not retried. Existing
GitHub connector reads and reviewable code/PR publication remain usable; diagnostic executions0.
