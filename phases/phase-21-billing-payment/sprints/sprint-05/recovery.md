# F05 recovery boundary (implementation notes)

Verified receipts are durably accepted with order validation before crediting. The single crediting transaction locks receipt, then order, then wallet and writes base/bonus ledger entries with wallet and terminal order/event state atomically. A callback receives HTTP 200 only after a terminal transaction is known to have committed. Validation failures use HTTP 400; unavailable configuration/database, lock contention and uncertain outcomes use HTTP 503. A body containing FAIL under HTTP 200 is not a provider retry signal.

The restart worker consumes the same durable receipt table and crediting transaction. Database errors are never broadly classified as permanent business failures. A wallet integer-capacity invariant may produce a durable FAILED/manual-recovery receipt without partial credits. Its deterministic payment-recovery:<orderNo> key must bind the future admin recovery operation; launch requires that admin flow, rather than two operators sending unrelated free-text grants. CLOSED late-paid orders cannot take the illegal CLOSED->FAILED edge, so capacity failures remain pending for recovery.

The public verified callback has no end-user tenant principal. Its shared-pool transaction is restricted to five owner-global billing tables. It cannot read org_billing_settings, identity or arbitrary tenant business data. SQL literals and parameters remain separate. No merchant query/reconciliation endpoint is added (requirements R6 excludes it).

Real merchant credentials and an authenticated deployed browser journey have not been validated. This feature alone does not make the full payment product available; cashier, expiry, admin recovery, subscription and token consumption remain separate followups.
