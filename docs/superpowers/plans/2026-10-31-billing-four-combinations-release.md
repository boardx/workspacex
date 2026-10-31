# Four payment combinations release and recovery

Refs #6050. This change adds Stripe credit topups and WeChat manual monthly passes. Existing WeChat topups and Stripe manual passes retain their respective financial ledgers. No existing recurring subscription is canceled by this change.

## Startup configuration

Set `BILLING_DEPLOYMENT` explicitly in each API runtime environment:

| Value | New WeChat purchases | New Stripe purchases |
| --- | --- | --- |
| `cn` | Allowed with configured merchant credentials | Denied |
| `us` | Denied | Allowed only with live Stripe credentials |
| `devapp` | Allowed with configured merchant credentials | Allowed only with test Stripe credentials |

`BILLING_WECHAT_ENABLED=false` and `BILLING_STRIPE_ENABLED=false` can further disable new purchases. Invalid explicit deployment values disable both. An unset deployment preserves existing deployments' explicit switch behavior for compatibility; rollout must set it rather than relying on that compatibility default. Credential getters remain available to historical callbacks, order reconciliation and management even if new sales are disabled. Devapp WeChat validation uses the configured merchant; enabling it does not simulate a sandbox or prevent real merchant charges.

Apply `20261031090000_billing_stripe_topups.sql` and `20261031091000_billing_wechat_monthly.sql` before deploying the matching API/Web. Existing rows default to Stripe for monthly passes. Credit order provider and session identity distinguish topups. Web and API must deploy together so provider requests and QR/hosted-checkout handling agree. Never expose payment secrets in public Web configuration.

## Settlement and recovery

Stripe topups reserve their credit order before contacting Stripe and use `credit-topup:<orderNo>` as the stable idempotency key. A lost creation reply is recovered by reusing the same order and exact parameter snapshot; a callback can bind the verified authoritative Checkout before the creation response is saved. Duplicate paid callbacks credit the permanent wallet only once. Stripe order expiration requires provider confirmation; the old 15-minute WeChat expiry worker excludes Stripe orders.

An unbound Stripe order older than 23 hours is deliberately held for manual reconciliation before provider idempotency retention may lapse. Do not delete it or create another payment to bypass it. Operators should find the original request in Stripe logs by its idempotency key and order metadata. If a Checkout exists, replay its signed completed event when paid, or recover that exact Checkout identity through the verified settlement path; never attach a different customer's session. If absence or closure cannot be established, keep the order blocked and contact support. Closing a confirmed never-created intent requires a separately authorized audited operator action; this release does not invent a payment-free assumption from a timeout. Existing orders and payment identities are retained.

WeChat monthly passes reserve a stable merchant order number before Native creation. Signed/encrypted notifications route by this durable identity and query the merchant before granting the monthly period. Missing notifications can recover through authenticated subscription reads. A 15-minute local timer hides QR codes but does not establish upstream closure; expired payable orders are closed and queried again, allowing a racing successful payment to win. Repeated callbacks use the same payment-period ledger. A pending order cannot switch provider while its outcome is unknown.

Legacy subscription overlap still enters the durable conflict queue and blocks new monthly purchases. Retain the previously protected CN historical test binding; an environment policy change is not permission to delete or cancel it.

## Acceptance

Verify all four product/provider combinations on devapp: permanent credit topups through WeChat and Stripe, and CNY180 / 20,000 credit / calendar-month manual passes through WeChat and Stripe. Replay signed callbacks and confirm stable wallet/period rows. Verify rejected amount, owner, provider and mode mismatches cause no credit grant. Confirm CN rejects Stripe creation and US rejects WeChat creation while historical reconciliation still runs. Production merchant settlement requires separate actual payment evidence; controlled provider integration does not constitute live settlement.
