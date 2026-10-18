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

14 closure tests pass locally. They execute harmless actual durable executor subprocesses, including all17
ordered stages in one test, then read205 original files without reexecution. They inject package
tampering, missing process/terminal, wrong request, failed/unknown command, residual group,
stdout/time drift, empty/symlink evidence and mid-collection changes. Filesystem root ownership is
an explicit disposable-subtree test seam, not a production guard change. External action/observer
and verifier bodies are fixture programs: these are not real17 production operations, backup,
restore, migration, six journeys, capacity/stability, remote terminality or30m acceptance.

The previously denied TLS navigation/artifact download/new public issue are not retried. Existing
GitHub connector reads and reviewable code/PR publication remain usable; diagnostic executions0.

Independent review found that timing validation and inventory capture were not bound across their
read boundary: a changed proof could remain stable during later reads. The fix binds inventory
identity, receipt and intent hashes to timing's hashes and rechecks each captured proof against
that captured receipt's pins. A new regression replaces each evidence/observation/admission/intent/
receipt immediately after timing returns and requires rejection.1100-level JSON now rejects through
the shared decoder's narrow RecursionError handling; both CLI regressions require fixed JSON/exit2
and empty stderr. Original hosted closure12-test CI39093805845 succeeded before these corrections;
that old-head receipt does not attest the fixes.

## Correlation proposal, not trusted source

`scripts/cn-release-evidence-correlation.py` is library-only. It correlates complete original snapshot
bytes with bounded raw GitHub run/jobs JSON: exact repository, main/manual workflow path/control SHA,
run/attempt/job/owner, successful terminal status and complete jobs pagination. It links the original
last package approval's fixed ECS target/identity with the final observe evidence's exact runtime,
all six canonical journey names, three unique owned run IDs, pinned30–300s stable window and sample
hashes. Workflow/job/intent/A6/receipt times must be consistent; even a fully rehashed altered target,
attempt or failed/skipped journey is rejected. No sample content, command, token or raw provider
response is output or executed. No arbitrary verifier or trusted=true parameter is accepted.

9 correlation tests demonstrate both rejection and the crucial limit: completely self-generated,
internally consistent files still return UNVERIFIED_SOURCE, productionAccepted=false and
thirtyMinuteProductionProven=false. The proposal derives workflowCreationToA6Seconds from GitHub
shaped bytes but does not call it verified request-to-A6 lead time. Request acceptance, authenticated
provider capture, cross-host clock error and actual protected canonical verifier execution remain
false/unverified. Raw GitHub JSON captured by this local API has no source attestation; hashes alone
cannot establish provenance. Root readback and real runtime/output evidence are still required.
Every correlation-layer read is pinned again to the captured inventory hash; a regression replaces
identity, A6 evidence, intent, receipt or admission after closure validation and requires rejection.

Next operational dependency is one supported existing GitHub manual-dispatch interface followed
by existing production-cn-promotion review, and an already approved protected evidence collector
on Shanghai. The diagnostic's existing authorization is not approval to install that collector.
If absent, its exact code closure/path/owner/read scope/expiry needs separate review; no IAM,
sudo rule, credential, runner privilege or security change is made here. No retry of the denied
browser/download or substitute trigger is allowed. Existing GitHub read/PR tools continue to work.
