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
- node --test .harness/scripts/ci-smoke-shards.node-check.mjs
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

Independent review found that the wrapper logs a derived ID rather than the input seed. The reducer now invokes the existing deriveTestIsolation function for the same mounted worktree and compares ID, database and Compose project exactly. A regression test rejects raw-seed observations and each independently altered resource. The new 18-test suite remains unverified until exact-head hosted execution completes.

Hosted control-plane checks on the initial head also exposed Vitest collecting the Node builtin test file and an unaudited download-artifact reference. The explicit Node suite is now named ci-smoke-shards.node-check.mjs and still required by the benchmark unit dependency; download-artifact uses the repository-required immutable audited commit. Neither failure is waived.


Failure-diagnostic follow-up: the baseline on64c1037e returned219passed+1flaky; first-pass rejection is retained.
Only sanitized part evidence is uploaded. Raw JSON, trace ZIP, screenshots, request headers, bodies,
attachments and error text are not added to artifacts. The rejection now preserves its fixed invariant
code plus bounded counts, fixed status enums, file/project SHA256 identities and attempt durations.
Unknown statuses become unknown; raw titles/names/messages never leave the reducer. At most20 failing
case rows and4 attempts per row are included. This helps distinguish a flaky case from namespace/schema
errors without expanding raw-trace collection. It does not explain the survey report's underlying delay.
The prior raw failure-artifact proposaldfb002a6 is superseded and must not be applied.


Host identity follow-up: run39108737566 had220/196/194 clean passes but aggregate FIXTURE_CONFLICT.
Its new safe part artifacts12130815436/12129923964/12130412041 were obtained normally with all ZIP
SHA256 checks; DB/Compose/seed differ, but all hostname SHA256 values match. This does not prove shared
or independent kernels: hostname alone was an insufficient instance identity. The old Forbidden
artifact was not retried or used.

Part/coverage schema v2 now requires a domain-separated SHA256 of the actual Linux
/proc/sys/kernel/random/boot_id read in the hosted report process. Raw UUID is not emitted.
Hostname hash remains diagnostic metadata. Shared boot identity, DB or Compose still rejects,
even if hostnames differ; repeated hostnames with distinct observed boots may pass. Missing,
malformed or inaccessible boot identity rejects, with no seed/run/random/env fallback.
The original isolation wrapper/ports/project dependencies/220-case checks remain intact.
This change needs new exact-source hosted evidence; the previous run cannot be retrospectively
certified because boot identities were not captured then. No performance or production proof follows.
