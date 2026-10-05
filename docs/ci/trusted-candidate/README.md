# Trusted candidate evidence — shadow rollout

Phase 1 records a single logical evidence owner per suite, authenticates candidate execution metadata, and compares it with main. Existing validation still runs. No result from this observer controls a job condition, required check, deployment or branch protection. Every decision is `skip: false`, `runFull: true`.

The coverage matrix is [coverage-matrix.md](coverage-matrix.md); the executable inventory is `.harness/config/ci-suite-ownership.json`. [backlog.md](backlog.md) assigns owners, acceptance and next actions. The open native recovery draft #5245 owns the existing Native source gap; this PR does not alter its workflow.

## Trust boundary and evidence

`ci-candidate-shadow` is a default-main `workflow_run` observer. It checks out GitHub's immutable main snapshot with credentials persistence disabled. It uses only the read permissions already used by harness verification, no secrets or OIDC, and never checks out or executes candidate code. The observer reads GitHub run/attempt/job/step metadata, logs, Git commit/tree/blob objects and artifact metadata. It does not download PR-authored manifest JSON.

A fixed identity action records the actual checkout immediately after checkout and before any candidate script, setup or dependency installation. The observer independently checks the logged tree and parents against Git objects, the candidate base/head and current PR, and the workflow/action definitions and the whole `.harness` / `.github` control plane plus root installation inputs against trusted base and main. It requires one marker within the fixed step's padded API time window. Log timestamps and JSON fingerprints are not signatures: unique markers, immutable definitions, external API facts and independent authority checks are all necessary. Ambiguity, malformed data or missing records cause full execution.

The manifest binds repository, observer and producer identities, attempt, actual checkout, base/head, complete source tree, definition and lock fingerprints, host toolchain/runner image, actual successful execution steps and GitHub artifact ID/digest. Main must have the tested base as its parent, the same head and the exact complete tree. Squash SHA differences alone prove neither success nor failure. New main/head, conflict, newer failure/cancellation/unknown result, stale/missing evidence, incomplete pagination, inaccessible API or validation exceptions cause full execution. Manual `fresh_run`, native reruns and existing independent heavy-lane dispatch remain unchanged.

## Runtime evidence limitation

The initial marker proves a pre-install checkout and host identity. It does not prove the later execution environment after candidate install hooks, Python setup, image pulls/builds or sandbox preparation. The adapter explicitly records this as `runtimeAttested.verified: false`; actual comparisons therefore remain ineligible. Successful algorithm fixtures are synthetic test oracles with independently bound runtime facts, not successful production receipt reuse.

This is an intentional activation blocker, not a passed runtime check. A future trusted runtime recorder must establish the actual execution toolchain, immutable container/image bytes, environment inputs and the candidate tree at execution without letting candidate code forge the recorder. Submodule/LFS closure, dynamic downloads, install hooks, discovery/nonempty test sets and complete suite coverage must also be closed. Runtime downloads, mutable action tags, floating service images, dirty/untracked execution inputs and history changes racing the observation also remain enablement blockers. Host version equality must never silently authorize reuse. Until that exists, this observer provides metadata and failure classification; it does not provide a production-ready transferable full-verification receipt.

## Controls and independent revalidation

`CI_CANDIDATE_MODE` is a repository variable: absent means `shadow`; `off` disables observer lookup. Unknown values and requested reuse/enforce modes refuse reuse. Neither permitted mode skips validation. There is no production skip mode in this change.

Existing harness `fresh_run` and GitHub rerun controls still request a new actual measurement. Existing Board native/meeting and other manual entries remain independent. Observer dispatch with `source_run_id` only reads an existing run; it neither reruns validation nor deploys it. Dispatch is not accepted as `workflow_run` authority for reuse.

The observer workflow must exist on main before GitHub can trigger its protected `workflow_run` path. This draft PR does not merge it. PR CI verifies its code and adversarial fixtures; a later approved merge can start protected shadow collection while still running the original checks.

## Validation and savings

[Local verification receipts](evidence/local-verification.md) record the successful and rejected fixture paths. Run `node --test .harness/scripts/ci-candidate-*.test.mjs` and `node .harness/scripts/lint-ci-suite-ownership.mjs`. The tests also register with the existing Vitest collector, preserving its scope. Workflow regression tests compare all original triggers, permissions, dependencies, conditions and steps with the baseline after removing only the added observation and regression steps.

[Historical probe](evidence/historical-run-37302506067.json) reads actual GitHub metadata and logs for the supplied successful deployment sample. It rejects reuse because that run predates the fixed identity step. This local read-only probe is not a protected observer receipt. Total 24m35s, gates until deploy 13m20s, deploy 11m14s. Phase 1 measured validation savings: **zero**. About 13 minutes is only an estimate for a future fully compatible path; it does not imply every CI run or entire PR is halved.

Enablement requires a separate approval after trustworthy runtime evidence, full coverage/migrations, current-attempt history handling, shadow source/main parity, adverse-case drills and independent review. Retain required verdict names and main's deployment, actual version, migration, health and real user flow checks. Predeployment isolated core-loop or a health endpoint cannot stand in for a deployed login/core journey.

References: [GitHub workflow_run boundary](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run), [Actions artifact metadata and digests](https://docs.github.com/en/rest/actions/artifacts), [job steps and logs](https://docs.github.com/en/rest/actions/workflow-jobs).
