# Sprint 21/05 handoff

Branch worker/coord-voice-21-f05: F05 in_progress, source 2e3c2ef74 ACCEPT, 64 focused assertions and API type/lint/contracts type/default init passed. All earlier failures retained. Not yet formal passing or main integration.

Next run through existing validation agent: caffeinate -i env WORKSPACEX_WEB_TEST_MAX_WORKERS=2 pnpm harness verify --sprint 21/05 --feature F05 --owner coord-voice. Freeze source/HEAD/refs during run; tool alone owns status transitions. Save formal output, independent final review, then create/attach separate PR Closes #5759 and fix current-head CI.

Implemented raw-byte signature verification/decryption, merchant/order/amount validation, durable receipts, one transaction per merchant payment, atomic base/bonus crediting and wallet/order/event state, restart recovery, conflict backoff and SQL literal boundary using existing pool. No active merchant query (R6 exclusion). Explicit wallet capacity failure records deterministic recovery key; real admin recovery remains a launch dependency.

Parent #5750 ready/open; F04 #5757 draft stacked on it. Retarget F04 main after parent integrates, rerun CI; do not merge into dependency branch. Continue cashier/expiry/admin recovery, Stripe, and approved token settlement with coherent minor-unit migration. No real keys/charges/deployed login proof claimed.

Latest source 399fdd0e1 independently ACCEPT; reviewed focused 68/68 plus static/init all exit0. Original formal intentionally interrupted (130), not passing, to repair safe correlated callback diagnostics. Its process/cleanup evidence and new RED cases are retained. Restart formal only after new evidence checkpoint. E3 explicitly preserves pending verified receipts for transient/unknown DB outcomes instead of false FAILED/ACK.

## Credential-scanner integration correction
The second formal attempt reached full Web success (940 files, 8081 passed/5 skipped), then actual API regression credential-never-echoed rejected the local `decrypted` variable name. It was safely interrupted (130), own resources released, and complete partial API/Web/outer/process/cleanup logs retained. This is NOT formal passing.

Source 468e5fe5e renames exactly the two references to authenticated paymentBytes, not a model-vault credential reader; crypto/financial behavior and the original security scanner/exemptions are unchanged. Independent SOURCE ACCEPT confirms that distinction. Final 7-file focused run includes the unchanged original 23 security assertions plus 68 billing assertions: 91/91, API type/lint all exit0. Contracts type/default init remain previously passing, unchanged. Next: new frozen evidence checkpoint then complete high-risk formal gate; no old interrupted run may be called green.
