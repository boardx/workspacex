# Private checkpoint recovery owner

This is a narrow engineering acceptance entry for the reviewed Stack04 checkpoint. It is not an installer, production restore utility, billing authorization, or an automatic step in `aidt:local`.

`node scripts/aidt-checkpoint-restore.mjs` defaults to an offline plan. It requires explicit absolute paths for the checkpoint, its evidence receipt, the two original budget ledgers, a new external private work directory and a private plan file. The plan verifies the known custom-dump hash, manifest, four originals and MIME sidecars, private file modes, original fixture credentials, saved-stage source records and unchanged budgets. No Docker, server, DB or model is started by this mode.

Apply is separate: `node --import tsx scripts/aidt-checkpoint-restore.mjs --apply --plan-file <private-plan> --approved-plan-sha256 <reviewed-sha256> --authorization restore-only-no-model --model-env-file <external-cn.local.env> --uvicorn <existing-uvicorn> --sandbox-modules <existing-modules-directory>`. Root reviewed the exact plan SHA and authorized the one zero-model recovery recorded here. This does not authorize an additional S2 run.

The owner obtains real machine-wide stack admission and fresh port leases, refuses an existing compose scope or target DB, uses standard migrations only in a temporary bootstrap DB in its new owned cluster, restores into a verified empty target, and copies objects to a new explicit private object root. It does not run the fixture reset seed. Only an actual restored-data receipt, exact container/port/lease/slot binding, protected-record hashes, full saved-stage values, real instruction-byte hashes and zero execution flags allow `e2e-up.sh` to skip that seed. Default startup without a receipt continues using its existing seed. The uploaded configuration supplies only the existing model whitelist; it never supplies DB, port, domain, ACL or deployment settings.

All five executors remain zero. Startup cancellation only marks abort and stops an existing owned child; a single `finally` owns cleanup. Controlled negative tests reproduce and prevent late Docker startup after listener-release cancellation and ready publication after cancellation. Empty-target and port-binding guards also have retained real red/green evidence.

## Actual zero-model recovery

- API/recovery source: `340f0ea2af1a85a91dd17eb0685b2b5d0b1eb978`.
- Reused Web build source: `ec5ff2e9de501426f3fec9a0dddd6dfb314be4cd`; no claim of a new HEAD Web build.
- Exact reviewed plan SHA: `f462fbb7b3c4de1e58a426e3cf78ddbcf27da6e6fd215663c6c5802ce0648f77`.
- Normal funded-admin login through the real Web UI succeeded. Actual org/user matched the restored account. Same-group S1 V2 and S2 V5 returned 200 and matched every saved field, source revision, author and timestamp.
- All four original GETs returned 200 with exact byte lengths, SHA-256 and five source headers; two PNGs decoded in the real browser.
- The first readback checker normalized only the HTTP MIME while the stored TXT MIME already included `charset=utf-8`. The retained failure/diagnostic shows matching bytes/hash/IDs/submitter/time. Normalizing both base types corrected the checker; the restore and seed were not repeated.
- Before/after protected records, old and canonical Agent versions, billing/usage/credit records and both budget hashes remained unchanged. Wallet stayed 19981.70 synthetic test credits with zero holds.
- Original custom dump and restored DB contain the same five `(thread id, org id)` pairs. No new thread, model task or budget reservation was created.
- Historical physical/usage/settled-credit counts remain 2/2/2; new requests during recovery are zero. Active, unsettled, holds and unbounded counts are zero.

Evidence: `checkpoint-restore-normal-readback.json`, `checkpoint-restore-thread-set.json`, retained readback failure diagnostics and `checkpoint-restore-unit-green.log`. The original checkpoint receipt remains a historical read-only backup record; this later recovery is separately verified.

S2's earlier echo-base run remains cancelled and charged in the original ledger. Its student output is the separately saved manual fallback V5. Recovery does not make that AI task successful, validate ordinary-student model funding, or complete the remaining teaching/model journey.
