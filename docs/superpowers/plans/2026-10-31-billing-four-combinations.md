# Four payment combinations implementation plan

> For agentic workers: use superpowers:subagent-driven-development or superpowers:executing-plans task by task.

Goal: credit topups and manual monthly passes work through both WeChat and Stripe. CN new purchases use only WeChat, US only Stripe, devapp both. Refs #6050.

Architecture: preserve existing credit order ledger and manual monthly order ledger. Extend each with the missing provider, durable intent before external payment creation, provider-bound authoritative settlement, and existing principal-scoped reads. Existing callbacks remain available when new sales are disabled. No live configuration or financial mutations in this task.

Spec: user-reviewed local billing design and explicit channel correction in this session; monthly price CNY180, 20,000 credits, one calendar month, manual renewal. Topup package snapshot determines permanent credits. Existing legacy subscriptions and retained CN test binding remain protected.

## Tasks

- [ ] Stripe credit topups: extend billing credit contract, order service/repository, fixed-endpoint Stripe adapter and settlement. Test paid replay, mismatch, principal ownership, pending recovery, cancel and disabled provider.
- [ ] WeChat monthly passes: extend monthly contract/service/repository with provider binding, Native client and signed callback routing. Reuse monthly grant and overlap lock. Test callback-before-bind, retry, amount mismatch and expiry.
- [ ] Composition and UI: wire adapters and callbacks; enabled provider controls both products, CN/US policy enforced server-side, devapp provider selector, Stripe hosted checkout and WeChat QR, no duplicate creation on uncertain outcome.
- [ ] Verify API/PG and Web tests, typecheck/lint, browser flows and independent review. Create develop PR and own checks to green.

## Review focus

Provider identities cannot cross-settle; duplicate callbacks cannot double credit; ambiguous upstream creation cannot create a second charge; different provider pending orders cannot overwrite each other; new-sales switches do not disable historical settlement. All four provider/product combinations require dynamic evidence before completion.

## Operational baseline

Latest main and develop fetched; branch from origin/develop 545191634, reused existing worktree. init.sh passed. harness readiness inspected; user-directed issue explains off-queue work. harness tick failed closed because COORD_GATEWAY_URL is absent; no authority lease fabricated.
