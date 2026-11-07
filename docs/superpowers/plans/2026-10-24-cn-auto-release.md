# main-cn automatic production deployment

## Intent and authorization

Issue #5910 records the user's request to synchronize develop and release China
production. The user subsequently requested automatic deployment after updates to
main-cn, with no human deployment approval. This replaces the old interpretation
of main-cn as a ref written only after production acceptance: it is now a desired
release ref. Successful native deployments and runtime evidence remain the record
of acceptance. A pushed branch alone never proves production availability.

## Design

A push to main-cn starts an orchestrator for its exact SHA. The orchestrator
requires that the SHA is contained in main and is still the desired main-cn head.
It dispatches the existing preparation workflow on main. Preparation retains the
offline-source, immutable-image, receipt, migration, Devapp and runtime gates.
Successful preparation dispatches promotion on its protected frozen tag.

Promotion has an explicit branch-push mode. In that mode an already advanced Git
ref does not mean that the runtime has been activated. The normal host baseline
receipt, native deployment identity, activation and browser verification still
run. A superseding ref rejects a stale attempt before switching traffic. Manual
verification and promotion retain their existing entrypoints.

Desired and accepted refs travel separately: a read-only automatic export derives
the consistent local accepted baseline, verifies it against the complete trusted
candidate object closure, and writes its ref only in a disposable private snapshot
used to produce the source bundle. The actual caches are not updated. Preparation
binds that old baseline; branch-push final CAS uses the desired ref. Reconciliation
first verifies the exact active SHA and attempt through the trusted runtime entry;
an already active run needs no fresh admission or activation.

The promotion environment has no required reviewer. Branch/tag allowlists and
immutable tags remain. main-cn keeps deletion and non-fast-forward protection;
its pre-push required-deployment rule must be removed because deployment now
follows a push. Do not remove the rule until the automatic pipeline is reviewed
and available on the intended commit. Do not manufacture successful deployments.

## Alternatives

Keeping the old pre-push deployment rule creates a circular dependency with a
push-triggered deployment. A bare compose restart would discard the existing
preparation and rollback guarantees. Reusing preparation and promotion retains
those checks while changing their trigger and approval policy.

## Implementation plan

- [x] Fetch main/develop/main-cn and freeze source identities in issue #5910.
- [x] Integrate develop with main, resolve interview fold contracts, and include
  the reviewed credit-runtime command repair from PR #5906.
- [x] Verify static checks (54 tasks), interview tests (29) and credit tests (26).
- [x] Add push orchestration and automatic preparation-to-promotion dispatch.
- [x] Adjust promotion mode and environment/branch governance, with counterexamples.
- [ ] Review the integrated exact SHA, run affected workflow/protocol tests and CI.
- [ ] Apply the matching GitHub rules and deploy the exact candidate.
- [ ] Prove runtime/browser acceptance; otherwise retain the precise blocker.

## Live boundary observed so far

The production runner is online. Read-only capability run 39984754226 proved that
several newer fixed-release entrypoints are absent; it did not inspect all legacy
preparation tools and cannot establish that the existing lane is ready. Optional
local full-init was stopped during an absent-pattern Playwright startup probe;
normal init and the specific validation above passed. The three existing develop
Chat failures remain release blockers until separately reproduced and resolved.

The revised exporter must be installed through the controlled host update path.
An exact, complete candidate cache and protected preparation inputs must exist
before this lane can run; no workflow approval removal supplies them. Missing
source remains CN_DOMESTIC_SOURCE_NOT_READY. No cache-writing sudo capability or
network object supplementation is added by the automatic exporter.
