# CI batch integration pilot (#6387)

This is an explicit coordinator pilot, not an enabled automatic queue replacement.
A batch contains at most three already reviewed and individually green original PR heads.
The pilot only admits web app/component TSX and CSS changes; identity, auth, database,
API, configuration and CI changes remain standalone.

Run from the existing clean checkout with Git and authenticated `gh`:

```sh
pnpm exec tsx .harness/scripts/batch-integration.ts prepare /tmp/batch-receipt.json 123 124
# Review the frozen base, member heads, exact merge tree and digest first.
pnpm exec tsx .harness/scripts/batch-integration.ts open /tmp/batch-receipt.json
pnpm exec tsx .harness/scripts/batch-integration.ts status /tmp/batch-receipt.json
```

Preparation uses Git object operations, leaving the checkout and index alone. Opening
pushes a new integration branch without force and creates one ordinary PR targeting
develop. It never dequeues originals, enqueues, merges, closes issues or projects checks.
The coordinator must select unqueued members and submit the reviewed integration PR
through the existing protected native queue. Existing healthy entries retain their order.
The candidate includes only the exact ordered member merge tree, with no manifest file
added to the business tree. The manifest lives in the PR body and a local digest receipt.
Retain that receipt as evidence independently of the editable PR body.

A failed combined digest is rejected, with singleton preparation commands implied by
its groups. Only a proven failing singleton head is blocked; a multi-member failure does
not establish which member caused it. Reprepare each proposed split with fresh eligibility.
No rejected receipt can reopen. No background waits or automatic retries occur.

The expected saving is one native queue candidate per batch, rather than one per original
PR. Individual admission CI and integration PR CI still run; this does not promise one
workflow execution overall or establish a measured 20–30 minute SLO. Accumulate eligible
arrivals for 1–2 minutes in the coordinator event loop, without keeping a CI runner asleep.

Do not report originals/issues/features as completed using integration checks. Existing
`doctor`, `pr-green` and China source admission rules remain authoritative. Activation
requires a live pilot proving GitHub's original PR merge metadata and the final source's
single associated integration PR, second-parent head and tree proof. The CLI currently
reports evidence for inspection and deliberately makes no merged/completion claim.

A manual `Batch integration pilot preparation` workflow provides a read-only remote
entry point and retains the receipt plus candidate Git bundle as a run artifact for
30 days. It has no write token and cannot open or enqueue a PR. Download both artifact
files, inspect the run provenance and receipt digest, then import candidate objects:

```sh
git bundle verify /absolute/path/batch-candidate.bundle
git fetch /absolute/path/batch-candidate.bundle refs/heads/batch-pilot-artifact
pnpm exec tsx .harness/scripts/batch-integration.ts open /absolute/path/batch-receipt.json
```

A base or member change between preparation and opening rejects the receipt. Re-run
preparation instead of updating the old receipt or force-pushing the integration head.

Opening atomically publishes the candidate branch and an annotated
`batch-receipt/<digest>` tag containing the manifest JSON. Its object SHA is retained in
the local receipt; reconciliation verifies the exact remote tag object before accepting
merge evidence. Neither the manifest nor its tag changes the tested business tree.
Protect the receipt tag namespace operationally; changed or deleted tags fail closed.

`status` records a failed combination in the checkout's durable Git rejection ledger.
The key includes the base and ordered original head SHAs, so rebuilding a commit with a
new timestamp cannot retry that combination. Proven singleton failures additionally block
that head. This ledger survives process restarts in this checkout; other checkouts must
consume the rejected receipt before dispatching retries. It is not a global queue service.

After a failed multi-member integration PR has been closed, explicitly apply the plan:

```sh
pnpm exec tsx .harness/scripts/batch-integration.ts split /tmp/batch-receipt.json --apply
```

This prepares and opens fresh singleton integration PRs, checking each member again.
Existing per-singleton receipts make repeat invocation idempotent. It never closes the
failed parent, changes queue membership, or assumes a singleton passed.

After the integration PR naturally merges through the native queue:

```sh
pnpm exec tsx .harness/scripts/batch-integration.ts reconcile /tmp/batch-receipt.json
```

Reconciliation requires the frozen integration head as the merged commit's second
parent, reconstructs the exact merge tree, verifies one associated merged integration PR,
checks current native queue workflow attempts and all policy checks, then re-reads attempts
to detect collection races. It records source SHA/tree, runs/jobs, member ancestry and
actual original PR metadata in a digest-bound evidence record. It rejects changed original
heads. This proof covers integration merging; production promotion still requires existing
CN source admission. A controlled live trial must confirm indirect PR metadata and release
admission before the pilot can be enabled generally.

To share a proven rejection across checkouts, explicitly publish it before dispatching splits:

```sh
pnpm exec tsx .harness/scripts/batch-integration.ts reject /tmp/batch-receipt.json --apply
```

This rechecks the failed frozen integration head and atomically publishes annotated
`batch-rejected/<composition>` tags; proven singletons also publish
`batch-rejected-head/<head>` tags. Fresh preparation/opening reads those remote refs and
refuses them across checkout/process boundaries. A changed base can retest a failed
multi-member composition; a proven failed singleton requires a changed head.

Concurrent explicit publishers reserve each original PR/head using
`codex/batch-lock-<PR>-<head>` refs in the same atomic push as the candidate and receipt.
Missing reservations use an empty expected ref lease; an existing reservation owned by
another candidate rejects publication. Split releases only its closed rejected parent's
exact reservations and preserves child reservations on repeated invocation. These refs
are coordination locks, never native queue entries or source branches.

Merge evidence uses GitHub's native merge-queue actor and `merged_at`. Reconciliation
reads at most ten historical attempts per run, selects each workflow's latest attempt
that began before the merge, and calls the shared `pr-green` merge-time reconstruction.
Post-merge reruns cannot repair red or incomplete merge-time evidence. Native job
`run_id`, `run_attempt`, SHA and timestamps must match; missing identity fails closed.

When the first observation happens after queue ejection, `status` discovers recent
`merge_group` runs from their exact native PR branch, fetches the discovered commit and
verifies the frozen integration head is its ancestor. Editable local snapshots are cleared
before observation. `reject --apply` performs a fresh observation; shared rejection tags
include that authoritative queue evidence, never a trusted receipt-only failure claim.
