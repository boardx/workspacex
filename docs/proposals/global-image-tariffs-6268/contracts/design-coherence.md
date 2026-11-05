---
status: pending
---

# Coherence review — #6268

Source review complete, pending independent/human confirmation: design GET/PUT maps to globalImageTariffOperations; fixed model/amount pairs enforced by Zod; no orgId/actorId or arbitrary prices accepted; empty schedule requires null revision, active schedule exactly three distinct models. UI unchanged; all use cases map to the coverage matrix. Migration/reservation implementation and local dynamic verification are complete; see docs/evidence/global-image-tariffs-6268/verification.md. Production activation and CI remain pending. No confirmation metadata fabricated.
