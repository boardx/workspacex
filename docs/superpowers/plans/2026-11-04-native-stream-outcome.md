# Native stream terminal outcome implementation plan

**Goal:** Record a normally completed physical OpenAI-compatible SSE response as succeeded even when its SDK closes before HTTP EOF. Preserve actual errors, cancellation, unknown usage and exactly one immutable receipt.

**Architecture:** The existing bounded UsageParser tracks a complete standalone SSE `[DONE]` event and sticky protocol/error evidence. Terminal success requires successful HTTP status plus complete SSE protocol (or existing nonstream EOF). SDK close can use this evidence; exception/finally paths remain failed. No API schema, payment selection, reservation, tariff, retry or permission change.

**Spec:** Issue #6232 and the established physical request accounting contract in docs/superpowers/specs/2026-10-22-unified-credit-consumption-design.md. Human authorization is continued chat recovery and final reported-token/payer/debit/outcome verification. Image tool failures remain issue #6233.

- [x] Capture actual deployed ddf run, reported tokens, personal payer and single ledger while preserving failed physical outcome evidence.
- [x] Reproduce using installed SDK/factory/transport: sync/async stream failed outcome, nonstream correct; add real stream close/exception counterexamples before production fix (8 red, 14 green).
- [x] Update only model_request_accounting.py: complete SSE event evidence; never turn unknown usage into zero; duplicate close still sends one receipt.
- [x] Verify fragmented CRLF DONE, missing/truncated/multiline/embedded DONE, named/JSON errors, oversized data, early close, cancellation, transport error and unknown usage in sync/async, plus whole deep-agent suite.
- [ ] Independent exact-SHA review, normal develop PR/source/queue checks, normal release by existing owner, actual running revision and one minimal post-release verification.

**Review focus:** A DONE-looking model string must not complete a response. Truncated event is not DONE. Error evidence is sticky. HTTP failure is not success. Unknown token counts stay absent. No replay or duplicate-close double terminal/charge. SDK error propagation remains intact.
