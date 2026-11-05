# Devapp voice credit admission — issue 6275

## Verified diagnosis

User-observed `asr.start` followed by `asr.error CREDIT_ACCOUNTING_UNAVAILABLE` occurs before an upstream ASR session opens. The public financial error intentionally conceals internal failure details.

Read-only devapp runner evidence:

- [41996762974](https://github.com/boardx/workspacex/actions/runs/41996762974): production ASR configured, product quota disabled; receipt directory configured, exists, private, writable and covered by a persistent RW mount. Five recent public accounting refusals; no ASR terminal-fault warning.
- [41997367222](https://github.com/boardx/workspacex/actions/runs/41997367222): exact live `dashscope / qwen3-asr-flash-realtime`; no matching native millisecond tariff in any organization, and no millisecond tariff for any other model. The actual API database configuration is used inside the running API container. A read-only transaction with `row_security=off` refuses an RLS-filtered false zero.
- [41997873517](https://github.com/boardx/workspacex/actions/runs/41997873517): official host maps to Beijing, 18 current organizations, all unpriced. Authoritative live minimum CNY top-up `credit-cn-10000-v1`, CNY 129.00 for 10,000 credits, version `catalog-cn-2cc7238acdeab60b248b9cd2f65f8afe2ad072ad92e5db1b67fcf16f335632ec`.

The causal code path is `PgAsrRequestAccounting.start` -> durable `prepareStart` -> `PgCreditConsumption.reserveInSession`: native millisecond usage requires an exact organization/provider/model/unit tariff even when the wallet has credits. A missing tariff raises the typed `credit_native_tariff_missing`, surfaced as `CREDIT_ACCOUNTING_UNAVAILABLE`. An instance-wide terminal accounting fault raises a different, ordinary provider error; it does not explain this public code. That behavior is deliberately unchanged.

## Authorized price and controlled recovery

User authorized ASR supplier cost multiplied by **3**, using the live minimum CNY credit top-up as exchange basis. This is independent of the image product's 10x rule.

[Official model pricing](https://help.aliyun.com/zh/model-studio/qwen3-asr-flash-realtime) lists Beijing CNY 0.00033 per input audio second and Singapore CNY 0.00066. Only the verified Beijing deployment is targeted. Customer money is CNY 0.00099 per second. Exact BigInt reduction gives **33 credit hundredths per 4300 milliseconds**. Round the complete request upward once to 0.01 credit; do not round each millisecond/second first. Examples: 1 second = 0.08 credit; 60 seconds = 4.61 credits; 300 seconds admitted maximum = 23.03 credits.

`.harness/scripts/vm/repair-asr-credit-tariffs.py` defaults to a repeatable-read **READ ONLY** preview. It fixes the exact model, official Beijing endpoint, quote version/SKU/amount/credits, and 18-organization inventory. The preview hashes organization IDs and existing tariff rows internally; output contains only aggregates and that digest. Apply requires the reviewed digest, acquires organization/table and existing per-tariff advisory locks, then inserts only missing rows and the existing append-only tariff-change audit in one serializable transaction. Existing overrides are preserved. The actor is explicitly `maintenance:github-actions:<actual run>:<actual actor>:issue6275`, with no invented platform user.

Rollback takes the same reviewed preview digest, finds only audited new rows from this repair, refuses any changed price/version, deletes those exact rows and appends a deletion tombstone audit. It does not alter outstanding request snapshots, balances, other models or organizations. Quote/inventory drift aborts rather than guessing a new scope.

## Verification and boundaries

- Thirteen local Python/Node mock tests cover private output, persistent mounts, read-only preview, precise integer rate, atomic rollback on audit failure, override preservation, quote/host/org/snapshot drift, and guarded rollback. CI `probe-contract` runs the same tests.
- ASR accounting classification regression: original five new cases failed before logging existed; 28 accounting/personal gateway assertions passed after it. Safe reasons are allowlisted, unknown details are reduced to a generic financial code, and the original refusal is rethrown unchanged. No SQL, credentials or audio/text bodies are logged.
- No singleton state change, global default tariff migration, provider bypass, free tariff, synthetic Token conversion or deployment is included.
- Current providers send `nativeUsage.source=estimated` for queued PCM duration. [Official server events](https://help.aliyun.com/zh/model-studio/qwen-asr-realtime-server-events) document `session.finished` without billed duration/usage. Existing settlement keeps that usage pending; this work does **not** relabel estimates as vendor-reported or claim a completed debit/released-hold loop.
- New organizations created after the controlled inventory need a separately reviewed default-price policy. This one-time repair covers only the current 18 organizations.
- No authenticated microphone session was synthesized or impersonated. Actual user transcription after configuration requires a user session or user reproduction, with content-free durable start/terminal aggregates as supporting server evidence.
