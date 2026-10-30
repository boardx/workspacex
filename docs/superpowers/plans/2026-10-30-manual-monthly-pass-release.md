# Monthly pass activation notes (#6038)

New sales create Stripe payment-mode Checkout directly with one inline CNY180 line item and no recurring terms. `STRIPE_RETURN_URL` (or existing `STRIPE_RETURN_LINK`) must resolve to this environment's /billing. Test/live keys and webhook signing secrets stay environment-specific. A static `STRIPE_PAYMENT_LINK` is no longer required by new sales; existing values are retained for historical callback reconciliation.

1. Apply `20261030140000_billing_monthly_pass.sql` before new API code. Existing recurring snapshots/bindings and credit periods remain untouched.
2. Deploy Web/API together. The upgrade operation becomes POST with an empty JSON object; cached old Web code issuing GET fails closed instead of creating a recurring sale. Refresh loads the current UI.
3. Inventory old Payment Links and linked subscriptions per deployment. Retire old recurring purchase links in Stripe only after confirming environment ownership, since copied old URLs can outlive a web deploy. Do not disable a shared link belonging to another application without evidence.
4. For existing live recurring subscriptions, verify customer, current period and environment before setting period-end cancellation. Read back Stripe's authoritative result and wait for the application projection to agree. Preserve paid time and unused current credit. Until verified, the concise legacy management action remains available and accurately says the original subscription still has renewal arrangements.
5. The historical CN test binding was explicitly retained by the user. Do not remove it, or call it with live credentials; no automatic cross-mode repair.
6. Verify a test-mode CNY180 Checkout and payment, callback replay, return-page recovery and expiry before promoting to live. Local controlled-provider acceptance is evidence of application wiring, not live merchant settlement.

Recovery: an ambiguous checkout-create response reuses the durable order's idempotency key. Unbound ambiguous orders older than 23 hours fail closed for operator reconciliation before Stripe's idempotency retention can elapse; never clear such an order merely to permit a second payment. Paid Checkout/PaymentIntent identities and credit period ledger are retained. Rollback code must not delete monthly order/credit records or resume historical automatic renewals.
