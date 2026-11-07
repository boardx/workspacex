# Standard development and deployment refactor

Status: approved direction from the human conversation; implementation pending.
Tracking: #5898. Supersedes execution ordering in the October 22 rollout plan;
existing production authorization and exact-source admission remain binding.

## Outcome

Feature branch -> PR to develop -> core plus affected validation -> reviewed merge
-> exact merged revision complete acceptance -> immutable candidate artifact
-> Devapp deployment -> version and business acceptance.
Redeploy selects the same accepted artifact, never an implicit latest branch build.
China production remains a separate approved promotion; US wiring is deferred.

## Observed baseline

At develop e0f94c1cc, product/Board/directory smoke run broadly on PRs.
Backend API shards and core-loop acceptance already exist. Devapp admission waits
for exact-source integration acceptance. The host deployment script still installs
and builds in the active checkout. Artifact-based Devportal delivery does not prove
artifact-based Devapp delivery. Neither this document nor a green PR proves release.

## Delivery contracts

1. PR change classification consumes a complete verified diff including renames and
   deletions. Missing base, unknown paths, changed classifier/tests, shared runtime,
   auth, contracts, schema or tooling fall back to broader validation or rejection.
2. A domain manifest owns source-to-test mapping and core scenarios. Selection is
   deterministic and reviewable. Developer labels cannot suppress required coverage.
   Core and selected tests must really execute; empty discovery is a failure.
3. Scoped PR evidence is never accepted as complete release evidence. Aggregate
   checks remain stable and reject missing, failed, cancelled or unknown obligations.
4. Release evidence binds source revision, test policy, platform and environment.
   Artifact identity additionally binds digest, build inputs and workflow identity.
5. Deployment consumes only verified immutable artifacts from trusted producers;
   fork PRs cannot write trusted caches, deployment secrets or privileged runners.
6. Redeploy does not rebuild or rerun unchanged source tests. It verifies retained
   acceptance and artifact identity, rechecks environment/migration compatibility,
   and executes deployment acceptance. Missing/expired evidence requires validation.
7. Failed activation retains or restores the previous accepted application version.
   Application rollback is not data rollback. Destructive migrations require explicit
   review and cannot be automatically reversed by a shell fallback.
8. Production approval is not relaxed. main-cn remains an acceptance pointer until
   its protected protocol, runtime baseline and branch policy are migrated together.

## Implementation sequence and proof

- [ ] P1: PR validation scope. Add a versioned source/test manifest and selector;
  integrate with harness workflow and sealed runtime without reusing full-lane
  receipts for scoped tests. Keep all full release producers on develop push.
  Test documentation-only, recording UI, interview UI, Board, API, shared code,
  lockfile/tooling, rename/delete, absent diff, unknown path and fork matrices.
  Use installed Playwright discovery to prove selected identities and dependencies;
  strict aggregate tests must reject an omitted selected producer.
- [ ] P2: workflow ownership and dependency targeting. Inventory duplicate execution
  by command and inputs, not check count. Resolve changed lockfile closures for
  billing/portal/release workflows; unknown dependency changes expand coverage.
  Preserve required-check presence and measure actual removed commands.
- [ ] P3: Devapp candidate artifact. Audit trusted host admission and current build
  inputs. Build outside the active release, publish digest-bound manifest, deploy
  only the exact accepted payload. Add missing/tampered/wrong-source fixtures and
  an actual candidate boot plus persisted business flow acceptance.
- [ ] P4: redeploy and recovery. Explicit artifact input, environment mutex, recorded
  previous release, version/readiness/business probes, bounded activation recovery.
  Prove build is not invoked on redeploy; exercise failed activation and verify
  previous version and persisted data remain usable. Unknown write outcome stops.
- [ ] P5: branch and operational documentation. Synchronize developer instructions,
  PR defaults and approved entrypoints. Introduce branch rejection only after an
  audit of active PRs and production obligations; do not blanket-block main merges.

Each implementation slice has its own issue/PR, RED-to-GREEN tests and independent
review. Do not mark items complete from static file presence. First run focused
fixtures, then actual cloud validation; integration and deployed acceptance are
separate recorded milestones. Reuse this session's worktree.

## Measurement

Measure PR-to-required-green, merged-revision-to-Devapp-accepted and same-artifact
redeploy-to-accepted separately. Report queue, setup/build, test, deploy and acceptance
time; publish sample count and median/P95 when sufficient samples exist. Initial
improvement claims require comparable actual runs, never an estimated SLA.
