# Chat agent selection evidence — #6190

Base: fetched origin/main and origin/develop before development; implementation starts at develop b7be8e0e6e2d12d70a0b7023193073013a6f7a45. Existing checkout reused, no additional worktree.

The failing native candidate 61f77d8c936d3c2fdb2b6f36de38392db367d2e2 / run 41617230208 / job 125854313320 selected no agent. Trace shows the official-role offer completing during pointer activation, followed by automatic matching and a successful deep-agent run. `[loopback]` is still the selected echo-provider protocol, so deleting its assertion would hide the failed prerequisite.

Changes: activate the real option by keyboard, verify exact selected id and nonautomatic state, and verify the outgoing agent header plus the persisted run's agent/provider. Existing skill snapshot, sentinel and reply assertions remain strict. Two real-browser regressions hold the actual official-role offer until focus, covering desktop and mobile selection from another agent.

Validation: ./init.sh exit 0 using the standard fast path (not --full). The corrected same-env/same-argv --list admitted exactly 3 cases in one file with --workers=1; actual browser execution passed all 3 in 3.6m, isolation wrapper exit 0, total 3m43s, cleanup 1s. Original F65 assertions and both new viewport regressions executed. After cleanup there are no owned containers or listeners on the ten service-role ports.

One earlier invocation accidentally passed an extra -- through nested pnpm scripts, causing 134 tests/5 workers to be selected. It was interrupted and is not acceptance evidence. Its verified owned processes and compose stack were explicitly removed before the corrected invocation. Both logs and the exact scope-checking runner are preserved.

Web tsc --noEmit exit 0. Main independently reviewed exact 0b31bead8ae0b1c5149418394045f6678eb075e5 against b7be8e0 and found no new blocker. Normal pre-push passed 27/27 (25 cached; 15.981s), push exit0; normal-push.log preserved. This follow-up changes only evidence/docs; implementation remains byte-identical to reviewed/tested code. Fresh source/native CI and merge remain pending. No claim that #6177 or this fix has merged.
