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
The complete suite must pass on standard GitHub Linux before this increment is reported tested.

Real Docker fixture has not run in this local non-GitHub environment. The PR workflow must run the
exact source head, all expanded Python suites and `test_minimal_docker_release_real.py --output
"$RUNNER_TEMP/fixed-cn-real"`; record its run/head/attempt/job/result separately after completion.
The pre-push hook runs typecheck/lint but reported zero matching tasks for this Python/doc scope;
it is not the test receipt. `./init.sh` succeeded before implementation.

No provider request, artifact download, production call, restore, migration, clear, cancel, rebuild,
new identity/permission or PR merge was performed in this increment. Raw A3/A4 proof in fixtures is
synthetic. Cloud identity, installed tools, actual provider/SQL capture, authentic approvals and real
six-journey acceptance remain unverified. The candidate is expired and production remains NO-GO.
