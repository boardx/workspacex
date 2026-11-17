# Stack04 checkpoint recovery: tested owner entry

> Latest state after the authorized S2 supplement: Plan03 was applied to restore-02, then the one S2 model task failed with two unknown-usage/pending credit records. Both restore destinations now exist and must not be reused. The latest full state is the separate private post-failure diagnostic backup, not the original two-run checkpoint. See [the supplemental task record](s2-supplement-20261116/README.md). That diagnostic backup is not zero-outstanding and has not been restored. No future original-checkpoint plan should be treated as preserving this newer state.

Updated 2026-11-16 after actual zero-model recovery. The original private checkpoint is retained unchanged outside the repository; it includes the logical database, both immutable Agent versions, same-group saved work, original objects, necessary normal-login credentials and exact copies of both budget ledgers. Its initial structure-only receipt remains historical. Actual recovery is now separately verified.

The new `scripts/aidt-checkpoint-restore.mjs` owner defaults to an offline plan. A separate `--apply` requires the exact reviewed plan SHA plus `--authorization restore-only-no-model`. Apply obtains fresh real port leases and standard stack admission, refuses any existing compose scope or target DB, restores only into its own new empty database and explicit private object root, and verifies actual container/port/lease/slot bindings and restored data. All executors/title/trial/extraction/scheduler remain zero.

Only its verified restored-data receipt permits standard `e2e-up.sh` to bypass the destructive fixture-reset seed and load the preserved fixture identities. The ordinary bare `aidt:real-model:dev --prebuild` path without that receipt still seeds as before and must not be used on a restored DB. `aidt:local` remains its separate zero-external-model default; it does not automatically import the model environment.

## What was actually tested

The reviewed plan02 was applied once to a new owned scope. Standard PostgreSQL/API/Python/Web startup and receipt-gated skip-seed succeeded. API/recovery source was `340f0ea2af1a85a91dd17eb0685b2b5d0b1eb978`; the reused Web artifact was built from `ec5ff2e9de501426f3fec9a0dddd6dfb314be4cd`.

A real browser performed normal funded-admin login. S1 V2 and S2 V5 returned 200 and matched every original saved value. Four originals returned 200 with exact bytes, SHA-256 and source headers; both PNGs decoded. Old/canonical Agent instructions were rehashed from actual restored bytes. Fifteen protected record/financial groups, both budgets and all five thread IDs remained unchanged. Historical physical/usage/credit counts stayed 2/2/2; active, unsettled, holds, unbounded and new model calls stayed zero. The MIME-checker mismatch and corrected readback are both retained.

The owner then received a verified normal SIGINT. Its child/compose teardown and lease/slot cleanup exited 0. Exact checks found 0 own containers/volumes/networks, all 13 ports bindable, all port leases and the stack admission released, and no live owned process. The original dump/manifest/runtime metadata hashes, credentials (0600), separate CN file (0600) and both original budgets were preserved.

Evidence: `checkpoint-restore-normal-readback.json`, `checkpoint-restore-thread-set.json`, `checkpoint-restore-cleanup.json`, `checkpoint-restore-final-unit.log` (45 passed), plus retained red/green guard logs and readback diagnostics.

## Historical plan03: subsequently applied

Plan02's destination already exists as private historical evidence and must not be reused or overwritten. A new nonce and new destination were generated in plan03, entirely offline, with the same verified immutable checkpoint and unchanged original budgets:

- Private plan: `/workspace/scratch/aidt-checkpoint-restore-plans-20261116/restore-03.private.json`
- SHA-256: `59500507741bccff83fc30c741c8ce6846fa69d7bb7cd651d04a4fb9a6cb62f4`
- New destination: `/workspace/scratch/aidt-real-model-20261116/stack-context-restore-02`
- It was subsequently applied with separate root authorization. The task round is now stopped and all resources released; the destination remains private historical evidence.

The following was the reviewed command. It is historical and must not be rerun against its existing destination:

```bash
node --import tsx scripts/aidt-checkpoint-restore.mjs --apply \
  --plan-file /workspace/scratch/aidt-checkpoint-restore-plans-20261116/restore-03.private.json \
  --approved-plan-sha256 59500507741bccff83fc30c741c8ce6846fa69d7bb7cd651d04a4fb9a6cb62f4 \
  --authorization restore-only-no-model \
  --model-env-file /workspace/scratch/aidt-private-config-20261116/cn.local.env \
  --uvicorn /workspace/scratch/aidt-real-model-20261116/python/bin/uvicorn \
  --sandbox-modules /workspace/scratch/aidt-real-model-20261116/sandbox/node_modules
```

These are this cloud engineering environment's private paths, not a user installer or a public preview URL. Restore keeps the historical S2 run cancelled/charged and its manual fallback V5. It neither completes that model task nor authorizes another one. Any additional S2 model request still requires the new task authorization and independent budget guard; no existing ledger may be reset.
