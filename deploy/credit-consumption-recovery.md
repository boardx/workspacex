# Durable model-usage receipts

The VM provision/deploy templates configure `WORKSPACEX_CREDIT_RECEIPT_DIR=/opt/workspacex/credit-receipts`. This directory is outside the Git checkout and build cache; preserve it during upgrades, rollback and backup. API-user permissions are directory `0700` and receipts `0600`. The storage preflight runs as the API user, validates owner/mode, and tests file/directory fsync. An explicit custom directory is preserved and must be on persistent storage owned by the API user. Container deployments must mount a persistent volume at their configured directory; never use `/tmp` or a disposable image layer.

Each request reserves a bounded local slot before model dispatch. Actual usage metadata (never prompts, provider bodies or credentials) is fsynced before the database write. The independent root-database replay worker retries the same receipt identity and removes it only after a committed idempotent settlement. Model execution is never retried by the receipt worker. Unknown provider usage retains its database financial hold for authoritative reconciliation.

When storage is full, unavailable or not private, new model admission fails closed. Preserve pending `.json` receipts and `.reserved` slots; do not delete them to restore service. Restore disk/storage access and restart the API with the same directory so the replay worker can resume. Inspect only metadata with operator privileges. A malformed receipt remains pending and needs investigation; it is never silently discarded.

The `.admission-lock` protects cross-process capacity admission. If the process dies while holding it, new admissions conservatively fail closed after five seconds, while receipt replay remains available. Stop all API processes sharing this directory, confirm none can still admit requests, and then remove only the empty `.admission-lock` directory. Restart with the original receipts intact. A `.reserved` file without a terminal receipt represents an uncertain request; reconcile provider/execution records before releasing its financial hold.

Changing the preflight setting does not erase receipts or holds. Enabling preflight rejects new usage when an earlier unbounded request has no confirmed settlement, even if the wallet was subsequently funded. Reconcile its authoritative usage first.

These changes to `deploy.sh` require the normal reviewed trusted-script installation after merge (`devapp-install-trusted-scripts`) before deployment; merging alone does not update the protected VM helper. No live server changes are performed by this PR.
