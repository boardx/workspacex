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

## Follow-up implementation and baseline correction

The first dedicated CI run 39000739379 tested the PR synthetic merge commit
`123c02ea…` associated with head `cc6e0ce58…`; it did not directly checkout that head.
Its successful results remain valid for that merge baseline. Revised dedicated CI explicitly
checks out `${{ github.event.pull_request.head.sha }}`. The real fixture still uses synthetic
application revision `aaaa…`, `sourceIsBC=false` and `productionAccepted=false`.

New local command `python3 -B -m unittest discover -s tests -p 'test_fixed_cn_bundle.py' -v`
passes 8 tests, exit 0, including real tar parsing/copy/reverification/manifest conversion,
actual `stage-local` CLI, tamper/race/expiry/identity/replay failure and exact existing protected
host-command generation. Log: [bundle-tests.txt](bundle-tests.txt). The revised 11 orchestration
tests also pass, exit 0, and now invoke this real-byte transfer adapter. Python syntax,
shell syntax, embedded probe Python syntax, YAML/exact-head-ref assertions, diagram and diff
checks pass. Updated real Docker six-stage chain runs only in the revised GitHub CI;
its result must be observed before claiming success.

The replacement probe's updated digest is [probe.sha256](probe.sha256). It has **not** run
on ECS. Adding current container/image identity, config/downloader hashes and fixed loopback
health does not inherit the old probe's approval. Actual native upload / protected ECS commands
were not invoked. See the plan's follow-up section for remaining implementation versus access gaps.


## Remote/approval/business adapter implementation

`python3 -B -m unittest discover -s tests -p 'test_fixed_cn_remote.py' -v`
→ exit 0, **16 tests**, 2026-10-17 04:47 UTC. Raw log: [remote-tests.txt](remote-tests.txt).
This executes the real RPC marshaling/transport/receipt/pipeline code against an actual loopback
HTTP provider fixture. It never executes received commands or contacts Alibaba Cloud. Covered:
full approved root-chain + two independent readbacks, authority/principal/source/run/command/
predecessor binding, A5 and provenance/candidate mismatch before effects, SQL unknown/changed
rejection before submission, lost ack and repeat rejection, provider identity/exit/truncation failure,
root waiting or missing stages stopping business calls, six-journey rejection, changed readback,
no ambient credential fallback, no IAM/cancellation API, running deadline + read-only reconcile,
and late-success rejection. Existing production browser/SDK installation remains unverified.

Before this adapter change, e2cd22818c1f0a9a41efbcc71e0a75d2424d5424 completed all PR checks:
7 workflows terminal (6 success, 1 skipped), including dedicated direct-head run 39001273184 and
harness-verify 39001272952. The existing read-only watch ended exit 0. Those results are **not**
attributed to this later change; the new head needs its own CI. New standalone API queries at
04:21 returned HTTP 401 Bad credentials; no login/new token/credential fallback was attempted.

## Independent takeover review and isolated regression

The stopped worker's final remote commit `e147fbb975a9eb9acd6d3904ec64784466213ac1`
was fetched and verified as one commit ahead of e2cd228, without divergence. An independent
worktree `/workspace/cn-release-review` retained all remote changes. Its direct-head dedicated
CI [39003972970](https://github.com/boardx/workspacex/actions/runs/39003972970) checked out
that exact SHA (checkout and git-log lines inspected): 16+8+11+13 tests passed, as did the real
Docker six-stage fixture, with `cleanupVerified=true`, `sourceIsBC=false`, `productionAccepted=false`.
Artifact ID 12089493864, 224967 bytes, ZIP digest
`9eb9826709cb5b8da9d51d64f72313efb945bc860d37785f342cb63385762c7a`.
Those results apply to that prior head, not automatically to the takeover patch.

Takeover fixes: original entry and user-authorization byte binding before effects; all-packet
principal/current A5-window admission; SDK debug rejection; actual nonzero driver-wait output
retention; historical-window read-only local receipt recovery; no overwrite or stage advancement;
and structural-only offline business validation without an A6-verified claim.

| Exact command in takeover worktree | Exit | Result |
|---|---:|---|
| `PATH=/tmp/cn-review-toolchain/node_modules/.bin:$PATH XDG_DATA_HOME=/tmp/cn-review-data npm_config_cache=/tmp/cn-review-npm npm_config_ignore_scripts=true ./init.sh` | 0 | pinned pnpm 9.15.0, dependency/fast-health init; lifecycle scripts disabled; not full repo verification |
| `python3 -B -m unittest discover -s tests -p 'test_fixed_cn_remote.py' -v` | 0 | 23 isolated tests; [takeover-remote-tests.txt](takeover-remote-tests.txt); loopback provider only, received commands never execute |
| `python3 -B -m unittest discover -s tests -p 'test_fixed_cn_bundle.py' -v` | 0 | 8 archive/manifest/argv tests |
| `python3 -B -m unittest discover -s tests -p 'test_fixed_cn_release.py' -v` | 0 | 11 orchestration/admission tests |
| `python3 -B -m unittest discover -s tests -p 'test_minimal_docker_release.py' -v` | 0 | 13 publisher tests, fake Docker and loopback HTTP |
| `python3 -B -m unittest discover -s tests -p 'test_cn_release_fixed_driver.py' -v` | 0 | 18 canonical driver tests, including actual CLI nonzero waiting and no repeat mutation |
| `python3 -m py_compile scripts/fixed_cn_remote.py scripts/fixed_cn_receipts.py tests/test_fixed_cn_remote.py` | 0 | syntax |
| `sh -n scripts/fixed-cn-readonly-probe.sh` | 0 | syntax only, probe never executed |
| `node .harness/scripts/execution-plan.mjs check docs/operations/cn-release-entry/plan.md` | 0 | seven production steps remain gray |
| `git diff --check` | 0 | whitespace |
| `PATH=/tmp/cn-review-toolchain/node_modules/.bin:$PATH pnpm harness readiness` | 0 | queue read; work remains user-directed #5809 |
| `PATH=/tmp/cn-review-toolchain/node_modules/.bin:$PATH pnpm harness tick` | 1 | COORD_GATEWAY_URL missing; no gateway lease or credential created |

Initial `npm_config_ignore_scripts=true ./init.sh` used ambient pnpm 11.19.0 and failed at the
unwritable default cache; pinned pnpm 9.15.0 with explicit /tmp cache/data paths resolved the basic
state. No source edits were made before the pinned init passed. The local Docker fixture is
GitHub-Linux-only; no environment-variable spoofing or production Docker command was used here.
The new commit still requires its own direct-head GitHub Docker fixture and CI; its observation
will be recorded on the same draft PR. No workflow dispatch or new runner permission is used.

At 2026-10-17 04:57:39 UTC the fixed original build listed only one artifact, the candidate-set
ZIP; eleven required entries were absent. Its listed expiry remained 04:57:52 UTC. The metadata
snapshot [artifact-incomplete.json](artifact-incomplete.json) is not a download proof. No original
bytes were obtained, no forbidden download retried, and no candidate rebuilt or replaced.
No production call, dispatch, migration, restore, production cleanup, cancellation or merge occurred.

### Exact takeover-source GitHub result

[Dedicated run 39004591383](https://github.com/boardx/workspacex/actions/runs/39004591383)
completed successfully on exact checkout `44bdd04b16dde9eb3fa920a3e68e0ca1e951ea6b` (checkout
and `git log -1 --format=%H` lines inspected). It passed 23+8+11+13 tests and the real Docker
six-stage fixture, with actual save/copy/Compose/HTTP and `cleanupVerified=true`. Synthetic
application identity remains `sourceIsBC=false`, `productionAccepted=false`. Artifact 12090985288,
225116 bytes, expires 2026-10-24T05:01:01Z, ZIP SHA256
`7b594ac1545f9cad287bf775715d5b685546ecd57bbc26e6863c57dfe7f267c5`.
The additional 18 canonical-driver regressions were run locally, not attributed to that CI job.

The final documentation-only update records the fixed build's empty artifact list observed at
2026-10-17 05:09:11 UTC, and clarifies root-driver versus argv-only transfer entry boundaries.
No source/test/workflow file changes after the tested code commit. Whole-repository workflows
remain independently reported on PR #5810; direct-head fixture success does not preempt them.
