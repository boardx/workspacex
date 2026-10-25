# Release PR CI repair — 2026-10-25

- User scope: repair failed validation on #5918, #5920, #5922; reuse this worktree. No deployment or database execution.
- Fetched main at `d291bdd3ecc68340987f6bdf0b4d5c619c47057e` before development. `./init.sh` passed its default dependency/health checks, not full repository validation.
- All three original runs failed `verify-control-plane` with the same six failing tests across four suites: legacy deployment contexts lacked the cutover variable, the CN queue test expected an old condition, and new download-artifact uses were not audited pins. Reproduced #5918 locally: 6 failed, 22 passed.
- Current main already retires those writers and migrates the tests (#5924/#5926). Integrated main into #5918, resolving two conflicts rather than duplicating legacy test fixes. Preserved baseline source validation/control checkout, new short tags, and explicit producer `--source`; pinned the remaining host-permission download action. Propagated through the stack without rewriting branch history.
- #5918 integration `f0b50068c84c6ee40758cfaa954a4e519aad8d72`; #5920 integration `01550fb28`. Their four formerly failing suites: 28/28 pass each. #5922 integrated tree: 28/28 pass. Raw local outputs are the adjacent `*-focused.log` files.
- Additional Python validation: registry producer 11; branch policy 8; reviewed CN schema/planner 8; host permissions 3; ECS auth 8; CN consumer/admission 14; DevApp release tests 11; CN browser probe 6. All passed. Fixtures prove local contracts, not live release acceptance.
- Whitespace checks passed. Normal pre-push affected typecheck/lint hooks passed for #5918 and #5920; no workspace packages were affected.
- A broad local test run on the superseded temporary legacy-test repair was stopped after switching repair strategy; it is not evidence for completion. Final cloud runs must pass on the new exact heads.
- Coordination tick could not run: this environment does not configure `COORD_GATEWAY_URL`. Readiness/dashboard/active-feature views were read; this user-directed CI repair does not claim unrelated sprint features.
- No new worktree, live database, release invocation, or Docker compose stack was created for this repair. No feature status was modified.
