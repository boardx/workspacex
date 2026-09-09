# Automatic main regression admission — #3227

Human decision, 2026-09-09: adopt one running automatic main regression and one latest pending candidate; intermediate commits need not each run the full regression. PR checks, explicit manual verification and deployment stay separate.

## Change and verification

Only first-attempt `harness-verify.yml` main push events use the fixed `harness-verify-main-latest` workflow group. `queue: single` replaces an older pending run when a newer candidate enters the group. `cancel-in-progress` is true only for PR events, so a running main regression finishes. GitHub decides queue admission order; this is not a promise that an executing SHA is still the tip of main. Superseded pending commits are cancelled/unverified, never successful.

PRs still use their unique `github.ref`, avoiding collisions between same-named fork branches. Native reruns (`run_attempt > 1`), manual dispatches, tags and other events retain run-id groups. `backend-gates.yml`, deployment, per-lane deduplication, test commands, required checks and assertions are unchanged.

The regression test evaluates the checked-in expressions for the supported subset (string equality, `&&`, `||`, `format`), rather than copying the policy into a separate implementation. It is not a complete GitHub expression engine or proof of hosted queue timing.

- `./init.sh`: passed the repository's default dependency/health initialization (not `--full`).
- Before workflow edit: event matrix 1 failed / 15 passed; the failure proves old main events had independent groups. See `validation-results.json` / `red`.
- After workflow edit: concurrency + lane dedup + full aggregate tests: 57 passed. See `validation-results.json` / `targeted`. A second red test (`rerunRed` in the results file) caught native reruns entering the automatic group; requiring first attempt fixes that boundary.

## Rollout and limits

The fixed group applies after this workflow reaches main. Already-created run-id groups are not moved into it, and no current running regression is cancelled by this change. Existing backlog must drain. Explicit manual runs still consume runner capacity; this is not an account-wide runner quota or priority mechanism.

Observe subsequent natural main pushes rather than manufacture extra heavy runs: one admitted run may execute; at most one pending candidate remains; replacement of pending candidates is intentional; the running run must reach a real verdict. Report queue delay separately from execution time. This change reduces automatic main overlap but does not by itself guarantee a five-minute queue or solve PR/backend capacity.

Rollback: restore unique run-id groups for main pushes. That restores every-SHA coverage and also restores the backlog risk.

GitHub concurrency semantics: https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency

## Independent validation

ci_baseline reviewed the event boundaries and returned ACCEPT. The original complete harness run covered 91 files / 1061 tests: 85 files passed; six files had 26 failures caused by sandbox IPC/socket permissions. Those six files alone were rerun with the required execution permission: 33/33 tests passed. After the native-rerun boundary fix, the concurrency file was independently rerun: 18/18 passed. Combined coverage is all 91 files and 1063 tests including the two added cases; this is not a claim that a single uninterrupted full run was green. The committed validation-results.json contains only allowlisted numeric summaries extracted from the actual logs. Raw original failures and retry logs remain local; they are not included in this PR.
