# CN credit guidance

Human approved the approach on 2026-11-05. Insufficient-credit terminal errors sometimes contain only the stable error code and no payer metadata. The existing shared notice then provided no recharge navigation. It now offers /billing for account review, retaining scoped checkout links only for verified account metadata. Accounting outages never offer recharge. No billing data or admission rules change.

Red: new UI regression failed because the link was absent. Green: three web test files, 19/19 pass, covering HTTP/SSE, preserved draft, attachment guidance, safe navigation and outage separation.

Operational work, separate from this code: two explicitly confirmed existing CN identities were granted platform_admins membership, transaction committed and both rows read back. No account credentials or balances changed. Browser reads timed out after the grant; cross-organization UI and enterprise upgrade are not yet live-verified. Existing platform organization screen contains EnterpriseManagementPanel; no duplicate upgrade endpoint is introduced.

The CN live credit refusal is not yet proven resolved end-to-end by this presentation change. The runtime must emit the typed CREDIT_REQUIRED error; MODEL_CALL_FAILED must never be reclassified from arbitrary provider text.

init.sh quick path passed; full validation not claimed. harness readiness ran; tick failed because COORD_GATEWAY_URL is not configured in this local environment.

Final web typecheck exited 0; scoped Next lint exited 0. Independent read-only reviewer found no actionable issues (did not rerun tests). Browser verified the logged-in platform operator can list all six CN users, both requested accounts display platform-admin badges, and role controls for other organizations are visible. Organization listing remains blocked: both PLATFORM_ORG_CATALOG_DB_USER and PLATFORM_ORG_CATALOG_DB_PASSWORD are MISSING in the CN API environment. Must provision a separately restricted metadata-only catalog connection and deploy it; do not substitute app_rw or a database owner.
