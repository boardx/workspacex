# Canonical automatic-release tool installation contract

This change reuses `prepare-cn-tool-install.py`, local package precheck and
`cn-tool-install-transaction.py` with its existing journal/recovery. It creates no
sudo entry, credential, policy, stable12 change, service action or new installer.
No host operation or installation was performed during this implementation.

The old exact tool is `8d0ffff2da8a22e10a8494540c3085f486cdaf62` (40 hex). Its Git
FILES has128 sources/90 installed targets. The previous main had139/97:11 added
sources, seven additional lib targets, no removed/retargeted sources and no new
bin entry. The corrected complete closure now has176 sources/109 installed
software targets. Adding the profile gives110 transaction targets, below128.
The source set is a superset of all old128 entries, allowing old profile
reconstruction against the new complete inventory without dropping old pins.

The additions are12 installed helper sources and25 source-only runtime files.
The existing verify-promotion/export bin paths join canonical FILES; they already
exist on the host according to the coordinator's independent observation. The
export source has one actual bin target, without an unnecessary lib alias. The
25 source-only files cover the three automatic TS entrypoints and their local
imports plus existing browser/migration probes. External dependencies still need
an independently prepared locked closure. A complete Git tree remains required.

Exact-source `INSTALL_MODES` selects20 public software sources as0755 for the
runner's read/compare checks. Owner remains root with no group/other write.
Everything else installed defaults to0700; source-only payloads remain0600.
Maintenance hold, recovery executors/verifiers, automatic dispatcher/provider and
baseline producer keep their existing0700 contracts. Only literal0700/0755
integer overrides for known installed FILES sources are accepted. Old tools
without this constant keep their original defaults. The profile schema itself
is unchanged; all old maintenance/controller/recovery/node fields are rebuilt
through each version's own Git-pinned schema.

New tools use `/var/lib/workspacex-cn/auto-preparation-tools/<SHA>`. Producer
continues deriving this contract from exact source AST. Transaction admits only
the two known root conventions, then requires the root to match that version's
actual source declaration and verifies all parents. It does not accept a
runner-owned `/opt` parent. Recovery source verification likewise derives its
root from profile-pinned identity source bytes; ambiguous roots fail. The browser
consumers accept the two fixed versioned conventions while keeping actual parent,
source/runtime hash and private profile checks. No unrestricted path is added.

`fixed_transport.ts` permits0755 only for the two literal release preflight
collector/verifier paths; migration snapshot collectors, writer modules and other
private executables still require0700. The canonical controller CJS was rebuilt
from its TS entry. The initial increment incorrectly duplicated compiler settings
instead of using the existing `.harness/scripts/build-cn-maintenance-controller.cjs`;
CI rejected that generated artifact. The follow-up uses that unchanged canonical
generator (tsx's locked esbuild0.28.1, node20 target, legalComments none). Its
permanent test invokes the original generator's `--check` for all three bundles.
The migrator also needs rebuilding because migration_library imports
source_plan_authority, which imports fixed_transport. The hand-written maintenance
browser CJS has no generator; its fixed root check was updated at its source.

Existing operational/maintenance fixtures had stale whole-collector block
assertions after automatic target selection/owned limits were added earlier.
Their actual two Node compatibility invocations are byte-identical to the
original fixtures after removing only `auto_probe_flags`. The updated regression
compares those entrypoint bytes directly, pins the unchanged actual SQL guard
block and executes it against forbidden writes and read-only BEGIN/SELECT/ROLLBACK.
No collector/SQL implementation was changed for this repair.

Executed validation:

- Python tool suites:102 tests passed, `/tmp/cn-tool-install-frozen-all.log`.
  `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s .harness/scripts/vm -p '*tool*test.py'`
- Consumer Python suites: maintenance admission12, candidate browser9, recovery
  verifier26 and maintenance activation8 passed. Logs
  `/tmp/cn-tool-consumer-maintenance-final.log` and
  `/tmp/cn-tool-consumer-{candidate_browser_acceptance_test.py,cn_maintenance_recovery_evidence_verifier_test.py,cn-maintenance-activation-test.py}.log`.
- Node production/source/migration transport consumers38 passed,
  `/tmp/cn-tool-controller-consumers.log`; browser/source closure6 passed,
  `/tmp/cn-tool-browser-final.log`.
- `pnpm --filter @repo/cloud-deploy exec vitest run src/cn-maintenance-host/fixed_transport_permissions.test.ts test/cn-maintenance-controller-parity.test.ts`:
  5 passed, `/tmp/cn-tool-fixed-transport-vitest.log`.
- `pnpm --filter @repo/cloud-deploy typecheck`: passed,
  `/tmp/cn-tool-cloud-typecheck.log`.
- Actual disposable Linux root Docker metadata test ran the compiled real
  `protectedExecutable` against its two literal public paths and actual private
  snapshot/writer paths. It accepted public0755/private0700 and rejected reversed
  modes, non-root owners, hardlinks, symlinks and wrong hashes. No network or
  writable host mount; --rm cleanup verified. Log
  `/tmp/cn-fixed-transport-real-metadata.log`. This is a container filesystem test,
  not a production host installation.
- An additional compatibility experiment reconstructed the old128-source profile
  from its actual old Git/schema and controlled runtime/metadata fixtures:
  `/tmp/cn-tool-old-profile-exact-git.log`. It preserves all eight original profile
  fields. This does not claim actual host inventory or provider acceptance.

Fresh actual complete inventory/provider receipt, exact merged tool Git artifact,
protected dependency closure, manifest review and existing root transaction are
still needed before software installation. The environment policy remains a
separate prerequisite; no values or success receipts are fabricated here.
