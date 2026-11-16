# S2 supplemental task: failed and stopped

One newly authorized S2 task was sent once. Run `40539aa6-2732-4661-9665-913013af806d` failed with `MODEL_CALL_FAILED`. No S2 resend, S3 or Design task followed. Executors were closed and all owned infrastructure was subsequently released.

## Accepted source and real accounting

The actual run pinned canonical Agent version `agent-version-fixture-428d072b-cf41-465b-86f7-6b02fe39136f`, exact `aidt-empathize` Skill version and saved S1 V2 + S2 V5. Its immutable snapshot hash is `326557fd5f9b8c5f2d30c8c9bec8c2a820ffbbf8e4c7787f071a8106c723968a`; the assembled reference hash is `e9527c822d1d11a723ed7676fdc17c5eca5a45de116f04c06c10e4298e73a6f6`. The new local/remote thread and remote run namespaces differ from the old cancelled echo-base S2. The late persisted dispatch observation is retained alongside the earlier UI receipt.

The one browser task produced two physical request starts and two failed usage receipts. Both have `total_source=unknown`, stored total 0 and NULL prompt/completion counts. Actual token consumption and supplier charging remain unknown. Physical admission records and native transport acceptance do not independently prove vendor receipt.

Both credit requests remain **pending**, with reservations 3412 + 5217 hundredths. Wallet held and remaining-held columns are each 8629 hundredths (86.29 synthetic test credits); these are separate columns, not an additive 172.58 debt. The balance remains 19981.70. No refund, hold release, artificial usage, state reconciliation or balance/role change was performed.

`failure_reason=provider_rejected` is the existing classifier's bounded label for a remote runtime error; it is not an upstream HTTP refusal finding. Actual private logs preserved only `APIConnectionError: Connection error`, without the underlying cause or HTTP status. The two starts must not be described as two successful completions or automatically attributed to SDK retries.

## Zero-model diagnosis and source repair

The first QA attempt stopped before any native request at the picker-selection assertion. Its precise original event timing was not established; a later zero-SDK diagnostic waited for the real directory and proved normal selection. Its one empty mounted thread was retained. A zero-SDK diagnostic and revised QA then reused that exact thread; no second thread was created for the actual send.

Two separately authorized HEAD diagnostics were performed, exactly once each. Both used the existing Python/httpx client, a validated non-model base path, no Authorization, no request body, TLS verification/trust_env enabled, retry 0, timeout 5 seconds and no redirects.

- Reconstructed old restore-launch network contract: inherited proxies present, CA variables absent; ConnectError → SSLCertVerificationError, errno 1, verify code 19.
- Fixed trusted-network helper at source `5df77b477`: CA/proxy/exclusion variables preserved; HTTP 404 received on the non-resource base path.

This reproduces the old launch CA compatibility defect and verifies TLS/HTTP connectivity with the corrected client environment. It does not add a successful model task, determine actual provider billing, or retroactively recover the failed run's missing low-level cause. The running model service was not retried or restarted to send a model after the failure.

## Latest private state and cleanup

A new private diagnostic dump preserves **3 runs, 3 AIDT snapshots, 7 application events, all 4 physical/usage/credit rows, pending reservations, all three budget files, four originals and normal fixture credentials**. Custom dump SHA-256 is `44dce740c3e27db191bcebd5e92723ad5d221a485c75020a2040fb06fc73d653`. It remains outside the repository/Library in a 0700 directory with 0600 files. Full financial tables were compared cell-for-cell via read-only COPY; all copied object/MIME files and three budget copies matched before shutdown.

This diagnostic backup has not been restored and is **not** a verified zero-outstanding recovery point. The old two-run checkpoint remains unchanged and does not contain this new failure or its pending financial state. It must not be used to pretend the latest state was preserved.

Normal owner cleanup exited 0: own containers/volumes/networks 0, all 13 ports bindable, all 13 leases and the stack-admission slot released; no owned live process remains. The restore owner's own `modelRequestsSent:0` exit field covers that program's actions only. This round's external browser task count is 1 and its new physical attempt count is 2.

Key evidence: `native-failure-details-accounting.json`, `attempt02-paid-window-closed.json`, both `one-head-*-network-contract.json`, `post-failure-private-diagnostic-backup.json`, `post-failure-backup-complete-verification.json`, and `final-cleanup.json`. Earlier zero-fee failures, preflights and successful restore readbacks are retained.
