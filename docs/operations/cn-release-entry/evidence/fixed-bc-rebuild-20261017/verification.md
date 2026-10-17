# Fixed BC rebuild continuation — 2026-10-17 UTC

Scope: one explicitly authorized same-source rebuild and ordinary image release only when existing
gates pass. Source `bc3d1254ce05c915801fb73fe6698072730a051c`, control
`5acebbb6741ed13c6379407aa0529c0eb8695b72`. No main/other candidate substitution.
No production command, new probe, permissions/credentials, migration, RLS/GRANT or data cleanup.

## Actual external action and duplicate protection

Before mutation, GET of original run showed completed/success/attempt 1; recent build workflow runs
showed no newer candidate build, and fixed release workflow list had total_count=0. The original
plan log (job 116816952492) was read and confirmed exact source/control/bases/source contracts.
The supplied plan recovered from that authenticated log is retained for review, not claimed as
original artifact bytes. The original build-only workflow at fixed control has contents:read only,
GitHub-hosted Linux runners, no secrets/environment/id-token/registry push/production action.

An exclusive private cloud intent was fsynced before exactly one command:

`gh api --method POST repos/boardx/workspacex/actions/runs/38852606085/rerun`

Exit 0 with `{}`; read-only GET confirmed run_attempt=2, unchanged control SHA, queued then running
at 2026-10-17T10:46:50Z. Intent/submission records are retained alongside this file. No replay,
new main dispatch, debug logging or cancellation. The normal GitHub rerun keeps original SHA/ref,
inputs and original actor privileges: https://docs.github.com/en/actions/how-tos/manage-workflow-runs/re-run-workflows-and-jobs

Run: https://github.com/boardx/workspacex/actions/runs/38852606085/attempts/2

## Explicit blocked production prerequisites

- GET repos/boardx/workspacex/actions/secrets: HTTP 403, Resource not accessible by integration.
  Names only were requested; no secret values read. No retry or alternate secrets endpoint.
- GET repos/boardx/workspacex/actions/runners: HTTP 403, same reason. No retry/runner change.
- Environment metadata read succeeded: production-cn-promotion retains required reviewer plus branch
  policy. Existing fixed release workflow requires the dedicated self-hosted production runner and
  a separately approved root-installed release_sha256. Availability and matching fresh approval/
  installed closure remain unproven; denial does not prove they are absent.
- One normal authenticated download of NEW plan artifact 12098721188 was attempted after verifying
  its run/control/name/expiry metadata. `gh api repos/boardx/workspacex/actions/artifacts/12098721188/zip`
  returned exit 1, zero bytes at 10:50:04 UTC. The detailed stderr was not retained, so this receipt
  does not attribute a precise provider reason. No retry, alternate endpoint or old-artifact retry.
  Metadata/digest alone is not original-byte verification. See plan-download.json.
- Four SQL compatibility results remain unknown. Ordinary release approval does not remove that gate
  or authorize SQL changes, RLS/GRANT, new identity, new probe or toolkit installation.

Therefore no production publish/transfer/acceptance call is made. One production release remains
unexecuted rather than repeated. Full six-journey business acceptance is still required.

## Isolated adapter verification

Adapters now bind exactly RUN_ATTEMPT=2 rather than silently accepting latest/either attempt. Plan,
archive inventory and original provenance must agree; prior attempt-1 evidence is rejected.
The user-approved source/control remain unchanged. This does not install code on the target.

| Command | Exit | Result |
|---|---:|---|
| `PATH=/tmp/cn-review-toolchain/node_modules/.bin:$PATH XDG_DATA_HOME=/tmp/cn-review-data npm_config_cache=/tmp/cn-review-npm npm_config_ignore_scripts=true ./init.sh` | 0 | pinned pnpm 9.15.0 fast initialization; lifecycle scripts disabled |
| `python3 -B -m unittest discover -s tests -p 'test_fixed_cn_release.py' -v` | 0 | 11 metadata/orchestration tests |
| `python3 -B -m unittest discover -s tests -p 'test_fixed_cn_bundle.py' -v` | 0 | 9 archive/inventory tests, old-attempt rejection before output |
| `python3 -B -m unittest discover -s tests -p 'test_fixed_cn_remote.py' -v` | 0 | 24 isolated RPC/authority/readback tests, old provenance rejected before effects |
| `python3 -B -m unittest discover -s tests -p 'test_minimal_docker_release.py' -v` | 0 | 13 publisher tests |
| `python3 -B -m unittest discover -s tests -p 'test_cn_release_fixed_driver.py' -v` | 0 | 18 canonical-driver tests |
| `python3 -m py_compile scripts/fixed-cn-release.py scripts/fixed_cn_bundle.py scripts/fixed_cn_receipts.py` | 0 | syntax |
| `node .harness/scripts/execution-plan.mjs check docs/operations/cn-release-entry/plan.md` | 0 | build separated from seven gray production steps |
| `git diff --check` | 0 | whitespace |

75 relevant local tests passed. They do not exercise production or prove access/SQL compatibility.
Exact new PR-head CI is reported independently once observed. Prior 459900a6b final 7-workflow
result (6 success, 1 skipped) and 55-test Docker fixture are historical, not assigned to this change.
