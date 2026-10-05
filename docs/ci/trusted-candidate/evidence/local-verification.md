# Local phase-1 verification receipt

Baseline: `d4f15668ace9883fc6ce3a20ab87032a18ec4a9d`. Validation date: 2026-10-05. This receipt describes local execution, not a GitHub protected-observer attestation.

| Verification | Result |
|---|---|
| `./init.sh` | exit 0; dependency/setup checks completed |
| `node --test .harness/scripts/ci-candidate-*.test.mjs` | exit 0; 245 pass, 0 fail, 0 skipped |
| Integrated Vitest, ten files listed below | exit 0; 368 pass, 0 fail |
| `node .harness/scripts/lint-ci-suite-ownership.mjs` | exit 0; 36 suites / 36 existing jobs, shadow only |
| `git diff --check` | exit 0 |
| Independent security reviewer Node rerun | exit 0; exact-SHA verdict recorded separately in the draft PR |

Integrated command:

```sh
pnpm exec vitest run --config .harness/vitest.config.ts --dir .harness   ci-candidate-evidence.test.mjs ci-candidate-github.test.mjs ci-candidate-workflows.test.mjs   ci-lane-dedup.test.ts ci-full-regression.test.ts ci-aggregate-consistency.test.ts   ci-aggregate-cancellation.test.ts workflow-actions-node24.test.ts   lint-ci-workflow-concurrency.test.ts lib/merge-queue.test.ts
```

The 245 new tests consist of 175 evidence-policy, 24 GitHub-adapter and 46 workflow/inventory tests. The additional 123 existing tests cover prior dedup, full regression, aggregate cancellation/consistency, Node action versions, workflow concurrency and merge queue behavior. All original workflow content is compared with the baseline after stripping only the new observation and regression-test steps.

Successful synthetic fixtures demonstrate equivalent complete trees across different squash SHAs and single-candidate merge-group metadata. Negative fixtures include source/base/head/definition/lock/runtime drift, forged or ambiguous log markers, candidate execution before identity, old-created runs rerun with newer failure, incomplete pagination, missing/expired/mismatched artifacts, real hosted-runner default group zero and malformed group values, API denial, invalid authority and exceptions. Every path retains `skip=false` and `runFull=true`.

A fully successful policy fixture uses synthetic independently bound runtime facts. The real adapter does not produce those runtime facts and deliberately sets `runtimeAttested.verified=false`; a same-tree API fixture still rejects reuse for `runtime_not_attested`. This proves the safe fallback, not production-ready transferable runtime evidence.

The [historical GitHub sample](historical-run-37302506067.json) was read from actual run/job/log metadata. It rejects with `identity_step_missing_or_not_successful`, since it predates these steps. No protected live shadow receipt exists before this workflow is approved onto main; no deployment or full browser suite was run locally. Original full validation remains enabled in PR CI.

Measured validation execution savings: **0**. The sample's approximately 13-minute gate interval is a future compatible-path estimate only.
