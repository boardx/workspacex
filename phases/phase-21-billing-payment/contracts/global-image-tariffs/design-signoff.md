---
bundle: global-image-tariffs
phase: "21"
covers: []
status: pending
---

# Global image tariff design approval — #6268

Direct-assignment issue #6268; no feature identifier is invented. Existing billing-credits approval is unchanged.

## ① UI
No new user-facing screen; see ui.md.

## ② Use cases
See usecases.md and linked design source.

## ③ API contract
Review the atomic global schedule GET/PUT described in the design source. Executable draft Zod schemas GlobalImageTariffSchedule and ActivateGlobalImageTariffs plus globalImageTariffOperations are in packages/contracts/src/billing-consumption.ts. Routes and database implementation are now present; local verification is recorded in docs/evidence/global-image-tariffs-6268/verification.md. Production activation is pending.

Human confirmation pending. Agent must not set confirmed status.

## Human instruction evidence

After the complete package was presented, the user instructed “直接处理”, then “那你直接完成然后验证，验证通过后提交PR到develop” in this session on2026-11-05. This records the authorization source; the agent has not fabricated confirmation metadata or changed the protected status.
