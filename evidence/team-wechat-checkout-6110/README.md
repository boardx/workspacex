# #6110 WeChat provider adapter preparation

Branch `worker/team-wechat-checkout-6110`, baseline develop `e676c171e` + shared provider port `804c35c41` (root d894 cherry-pick). Existing Stripe preparation remains preserved at `8a8ce549bbe244544f73c151779a8b36db426306`; capacity PR #6123 remains preserved at `9001b5c25e01bc1a95d7cd619e50743de97b6466`.

Scope: Team Native creation from persisted TeamPaymentSnapshot only. Required checkoutExpiresAt is a persisted payment deadline independent of quote.expiresAt. The common core must generate/persist it using the existing PERSONAL_WECHAT_PAYMENT_TTL_MS policy; this adapter never derives it or recalculates price/credits/seats. Future unpublished Stripe preparation must adopt this required field before wiring.

purchaseRef is the merchant out_trade_no (6–32 legal ASCII), stable across retries. Amount/currency/period are frozen quote facts. Attachment is the same TEAM_PAYMENT_PRODUCT marker as Stripe, generation and purchaseRef only, bounded to 128 bytes. Initial/renewal are manual Native orders; topups are Native orders; add_seats explicitly unsupported pending #6113.

Native createNativeOrder is a thin legacy wrapper retaining its default description expression. createNativeCheckout accepts only actual merchant wire facts and reuses the original fixed endpoint/signature, 8-second deadline, 64KiB body limit, optional platform signature verification and QR validation. No actor or credit fields are fabricated.

Verification: Node 22.23.2, `pnpm --dir apps/api exec vitest run --config vitest.team-wechat-unit.config.ts`. Initial red: new Team module absent, 20 existing pure tests green. Final green: Team 20 + existing personal WeChat 18 + Native bounded-body 2 = 40 tests, 3 files, exit 0 (1.76s). Tests cover frozen amount/cycle/deadline, expired quote independent of payable deadline, stable retry reference, isolated metadata, illegal reference/currency/provider/generation/amount/renewal rejection, near-deadline rejection, disabled deployment, QR validation and legacy wire/default-description equivalence. Raw outputs alongside.

No PostgreSQL, browser, full package type compilation or hooks started. Existing Native diagnostics and reference compatibility files were inspected and found to depend on database fixtures; they were not represented as pure verification or executed here.

This is provider adapter preparation, not delivery of the full #6110 feature. No callback route, authoritative settled receipt/recovery, purchase repository/idempotency, wallet, license, entitlement or grant implementation is included. A Native QR is not evidence of payment. No push or mixed PR.

Official merchant constraints: https://pay.wechatpay.cn/doc/v3/merchant/4012791877 (out_trade_no, attach, time_expire). Future receipt matching must use persisted core snapshot, not trust the attachment alone.
