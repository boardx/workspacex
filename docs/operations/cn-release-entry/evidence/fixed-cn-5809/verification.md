# Verification receipt — issue #5809

Cloud workspace `/workspace/workspacex`, 2026-10-17 UTC. No Mac, production connection,
production deployment, migration, restore, production cleanup, cancellation or dispatch.

| Exact command | Exit | Result |
|---|---:|---|
| `PATH=/tmp/cn-toolchain/node_modules/.bin:$PATH XDG_DATA_HOME=/tmp/cn-data npm_config_cache=/tmp/cn-npm npm_config_ignore_scripts=true ./init.sh` | 0 | pnpm 9.15.0 install and repository fast health checks; native/lifecycle scripts skipped; not full repository tests |
| `python3 -B -m unittest discover -s tests -p 'test_fixed_cn_release.py' -v` | 0 | 11 tests; complete staged mock integration with actual publisher CLI and loopback HTTP, six stage-failure subcases, evidence missing, six wrong-evidence subcases, repetition after success and failure, source mismatch, timeout, expired/missing/duplicate/empty artifacts and wrong control/run/attempt/workflow |
| `python3 -m unittest discover -s tests -p 'test_minimal_docker_release.py' -v` | 0 | existing 13 publisher tests; real CLI with fake Docker and loopback HTTP; schema drift/empty inventory, compose/env drift, lock busy, image mismatch and health deadlines |
| `python3 -m py_compile scripts/fixed-cn-release.py tests/test_fixed_cn_release.py` | 0 | Python syntax |
| `sh -n scripts/fixed-cn-readonly-probe.sh` | 0 | shell syntax only; did not execute probe |
| `python3 scripts/fixed-cn-release.py probe-hash` | 0 | new source digest, executionApproved=false |
| `python3 scripts/fixed-cn-release.py inspect` | 0 | live GitHub metadata for all 12 artifacts, ready=false; no image bytes verified |
| `node .harness/scripts/execution-plan.mjs check docs/operations/cn-release-entry/plan.md` | 0 | canonical diagram format; all production nodes gray |
| `git diff --check` | 0 | patch whitespace |
| `python3 -I -B tests/test_minimal_docker_release_real.py --output /tmp/fixed-cn-real` | 2 | `LINUX_GITHUB_ONLY`: fixture intentionally rejects this non-GitHub environment before creating resources. Not passed. GitHub CI is the intended executor. |
| `PATH=/tmp/cn-toolchain/node_modules/.bin:$PATH pnpm harness tick` | 1 | existing `COORD_GATEWAY_URL` absent; no lease/loop claimed; no production channel created |
| `PATH=/tmp/cn-toolchain/node_modules/.bin:$PATH pnpm harness readiness` | 0 | queue inspected; user-directed release work tracked by #5809 |

YAML static check exit 0 (PyYAML installed in this cloud environment):

```bash
python3 - <<'PY'
import yaml
w = yaml.load(open('.github/workflows/fixed-cn-release-tests.yml'), Loader=yaml.BaseLoader)
assert set(w['on']) == {'pull_request'}
assert w['permissions'] == {'contents': 'read'}
assert w['jobs']['simulation']['runs-on'] == 'ubuntu-24.04'
assert w['jobs']['simulation']['timeout-minutes'] == '12'
for step in w['jobs']['simulation']['steps']:
    assert not {'environment', 'secrets'} & step.keys()
print('YAML parsed; PR-only hosted runner, contents-read and bounded timeout verified')
PY
```

Actionlint was not available. Installing it using the environment's `go` command failed
(`Go: Unknown option: install`, exit 1); no actionlint pass is claimed. The static YAML
parse above does not replace GitHub workflow execution.

Initial default init failed on unwritable default cache paths; pnpm 9.15.0 installed
in `/tmp/cn-toolchain` using `npm_config_cache=/tmp/cn-npm`, then the exact successful
init command above resolved it. Initial `inspect` exposed old gh 2.46.0 lacking `--slurp`;
the implementation now uses bounded single-page API reads and refuses incomplete inventory.

Raw test logs: [orchestration-tests.txt](orchestration-tests.txt),
[publisher-tests.txt](publisher-tests.txt). Isolated negative-case receipts are summarized in
[scenarios.json](scenarios.json). Full per-stage intents/evidence/hash receipts live in
`/tmp/fixed-cn-simulation-evidence` and are uploaded by the PR workflow for seven days.
No fixture receipt is a production receipt. Live artifact download remains blocked as recorded
in [availability.json](availability.json); metadata observation is not availability proof.

Commit and remote CI evidence are reported in the draft PR and final handoff; this file does
not mark checks that have not run as passed. Merge and production execution remain prohibited.
