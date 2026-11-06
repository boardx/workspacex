# Contract repair verification

Source/commands/exit codes and original logs are retained here. `results.json` records the frozen
Python source run: 22 suites / 229 tests passed, two actual canonical bootstrap proof integration
modes passed, shell syntax and diff checks passed. `source-snapshot.json` identifies the tested
bytes. Python sources did not change during or after that run. Workflow-only follow-up adds expanded
suites to exact-head GitHub CI. `static-checks.json` records compilation/read-only CI/four-color checks.

One additional local suite ran 12 tests but failed (5 errors, 1 failure) because the protected legacy
conditional writer store rejects this container's foreign-owned root ancestry. Original failure log
`19-cn_release_conditional_writer_adapter.log` is retained. `legacy-fixture-environment.json` records
UID/mode and unchanged protected source. No production check was weakened or test silently skipped.
The same 12-test suite subsequently passed on standard GitHub Linux, exact source below. The local
failure remains retained and is not relabeled as a local success.

Real Docker was run on GitHub Linux, not this local non-GitHub environment. Exact source
`384c3b7830cfb2afcdb7eee70f30f37d08fe50c8`, [run 39031167276](https://github.com/boardx/workspacex/actions/runs/39031167276),
attempt 1 / job 117391736657, completed SUCCESS at 2026-10-17T12:08:04Z.
All 23 suites / 241 tests passed, no required tests skipped; both canonical bootstrap modes passed.
`python3 -I -B tests/test_minimal_docker_release_real.py --output "$RUNNER_TEMP/fixed-cn-real"`
passed the real Docker/Compose/save-transfer/HTTP six-stage simulation in 26.245 fixture seconds,
with `cleanupVerified=true`, `sourceIsBC=false`, `syntheticImageProvenance=true`,
`productionAccepted=false`. See original `github-source.log` and parsed `github-docker-result.json`.
The wider repository checks were still pending when this evidence was recorded; the saved snapshot
is explicitly partial, not an all-checks-green claim. Subsequent evidence-only commits retain these
source bytes; do not attribute this source run to a different head.
The pre-push hook runs typecheck/lint but reported zero matching tasks for this Python/doc scope;
it is not the test receipt. `./init.sh` succeeded before implementation.

No provider request, artifact download, production call, restore, migration, clear, cancel, rebuild,
new identity/permission or PR merge was performed in this increment. Raw A3/A4 proof in fixtures is
synthetic. Cloud identity, installed tools, actual provider/SQL capture, authentic approvals and real
six-journey acceptance remain unverified. The candidate is expired and production remains NO-GO.
