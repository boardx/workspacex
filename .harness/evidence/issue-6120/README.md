# Product configuration — work in progress

User authorized configuration-driven existing pricing, preserving default UI and paid snapshots. Reuses credit_packages; no new pricing table or configuration backend.

Actual selected checks: configured catalog behavior first 2 red / 6 baseline green; after reader injection and bounded configurable quantities, catalog 8 green. Catalog and checkout service selected pair 20 green. No full-suite, new-schema PG, or integration PASS is claimed.

Runtime catalog and checkout read the same configuration; a content fingerprint changes whenever commercial facts change. Checkout locks configuration while persisting the immutable purchase. Subsequent paid monthly allowances are captured once in paid-term.monthly_credits from the verified purchase (existing trusted internal receipt callers freeze the current configured product). The v1 migration default preserves historical 20,000 allowances, rather than repricing old terms. Later scheduled grants never look up today's price.

Pending: complete fixtures for dynamic catalog versions, selected real-DB configuration-change/snapshot assertions, exact-source independent review, normal hook and CI. Team provider wiring remains separately staged. This is not DevApp activation or data reset.
