# Full smoke timing and isolated-shard benchmark

Refs #5813. This opt-in PR benchmark does not replace harness-verify or any release gate.
No production workflow, trigger, permission, environment, credential or runner privilege is changed.
Existing exact-command/digest/UID/secret/apt restrictions remain in ci-fullstack-runtime.mjs.
The added shard mode accepts only its fixed package command, indices1–4 over2/4, an explicit
benchmark flag, GitHub-hosted context and a fresh run/attempt/part isolation seed. Canonical
nonbenchmark commands retain their original behavior.

## Why naive sharding is unsafe

The220-case canonical seeded-github-import command includes stateful predecessor projects.
Deleting those dependencies, setting fullyParallel=true or reusing another shard's DB would
change coverage or fixture semantics. This benchmark preserves the original project graph and
file-level serial behavior. Each independent hosted job gets its own VM, reserved ports,
isolation seed, actual observed DB and Compose name, fresh app build and original teardown.
No self-hosted/CN runner is selected.

Part0 runs the full canonical command; parts1/2 run the same project with Playwright's built-in
shard option under the original isolation wrapper. Dependencies are deliberately re-executed
inside each shard's own fixture. The reducer requires220 distinct baseline case IDs and the same
unique union, each primary case once, every prerequisite in each shard, no unknown/missing IDs,
and no skipped/flaky/expected-failing/retried cases. Replicated prerequisite executions are reported
separately and are not extra unique coverage. This can reduce gains: no speedup is assumed.

## Evidence and failures

The existing Playwright JSON reporter supplies project/file/describe identity, per-case UTC start
and duration, suite start/duration and actual result. Raw titles, stdout/stderr, errors and attachments
are not copied into the new artifact. Case identity hashes include describe ancestry to avoid
collapsing parameterized tests at the same source line. Each artifact includes the original JSON
SHA256, source/run/attempt, observed shard, actual isolation log namespace and a host fingerprint.
Aggregation rejects duplicate host/DB/Compose namespaces and requires all benchmark/unit jobs
to succeed. fail-fast=false preserves other shard results on failure. Missing reports, test errors,
cleanup failures and timeout never become passing evidence. The default40m job timeout is retained;
30m is a measurement goal, not a reason to kill necessary recovery. No automatic retry is added.

Fine-grained case-duration sums are not release wall time. The benchmark's source/request/queue/job/
artifact aggregation times must be read from actual GitHub metadata after completion. Any work
inside an actual release request remains in its total clock; the original expired BC attempt is
not restarted or relabeled. A successful source benchmark is not real A0–A6, production acceptance,
or proof of30m. Both productionAccepted and thirtyMinuteProductionProven stay false.

## Current increment

Created through the existing GitHub connector while cloud shell recovery remained unconfirmed.
No local execution result is claimed. The new unit job and three fresh benchmark jobs will supply
the first executable receipts. Existing source PRs5815/5816 keep their frozen accepted heads.
Benchmark source is frozen on their a41a266 lineage, not an admitted production candidate; unrelated
main3eb7d004 billing changes are not overwritten. All production stages remain unverified.

Commands used by hosted CI:
- node --test .harness/scripts/ci-smoke-shards.test.mjs
- baseline: existing fixed runtime run command
- shards: fixed runtime shard command, then original with-test-isolation
- sanitized report and complete220-case aggregate

Official contracts:
- https://playwright.dev/docs/test-sharding (file-level granularity unless fullyParallel)
- https://playwright.dev/docs/api/class-reporter
- Playwright1.62.0 is the version observed in the original measured job.


First hosted execution failure retained: run39097870699/unit job117587955679 failed in setup-node
before any unit test. The action resolved .nvmrc to22 then tried to locate pnpm before it was set up.
Coverage bootstrap failed similarly and benchmark was skipped by needs:unit. No test/coverage/speed
pass is claimed. The fix installs the repository-pinned pnpm before setup-node in unit and coverage,
matching existing canonical job order. It does not add credentials or bypass a check. Old active PR
runs must finish before its expected-old non-force head update, so no existing run is canceled.
