# Maintenance release identity admission

Issue #5547. The release path admits only the exact pairs in
`../cn-maintenance-release-identities.json`. Membership is necessary, but does
not authorize a command: the original protected writer plan, independent root
profile, raw hashes, runtime identity, attempt, hold and tool revision must still
agree at their existing gates. Mixing the source from one pair with the baseline
from another, or approving an arbitrary third pair in request JSON, is rejected.

`../generate-cn-maintenance-identities.py` mechanically emits the same predicate
into the existing Python/Node executable closures and the bundled TypeScript
helper. It adds no runtime file search or ambient import. Run it after a reviewed
registry change, then run it with `--check`. The registry, generator and TS helper
are included in `cn-build-tool-identity.py` source hashes.

The new pair has no default release string. Release approval comes from the root
profile's `candidateComposeEmitter.optionsRef`, the referenced `manifestRef`, and
`configRef`: all raw SHA-256 pins are checked, manifest source matches the approved
identity, and `manifest.release` equals `config.provision.release`. The references
are read again to detect drift. A receipt cannot approve its own release. The
historic pair retains its explicit legacy completion convention for old callers.

Source-relative paths and OCI revision labels now use the admitted identity.
Retained backup also requires the same complete identity as its already-open
control session. The migration, database, writer, recovery, acceptance and public
promotion safety checks remain in force.

## Validation and operational boundary

The `Maintenance release identity contracts` workflow runs the Linux FD and child
process tests, Python staging/resume/pointer tests, actual Node held-query and
recovery modules, and TS original-plan/factory/completion entry points. It also
checks both generated identity predicates and the committed maintenance bundles:

```sh
python3 .harness/scripts/generate-cn-maintenance-identities.py --check
node .harness/scripts/build-cn-maintenance-controller.cjs --check
```

This source change does not install tools or grant production permission. Before
A0 can pass, the exact merged control revision must be compiled/installed and its
new hashes approved. The source-specific candidate Compose emitter must be built
using `build-cn-candidate-compose-source.mjs` with the independently approved
original plan and manifest, against the exact candidate checkout; its generated
source-closure proof must match. The historic checked-in candidate Compose bundle
is not evidence that the new candidate is ready.

Every new attempt still needs its own protected plans, source policies, epoch
backup/isolation evidence and approvals. This change neither executes database
migrations nor resumes writers, and it does not replace any A0–A6 gate.
