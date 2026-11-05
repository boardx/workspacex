# Research query6253 bounded source review

Exact base `5832cdb62c08fe4f8917776760626d71c74fea11` → head `75148e4d6783beadc52cab501b56d3264697e798`. Verdict: **STATIC CLEAN; no actionable P1/P2 confirmed in the four requested source/test paths**. Read exact Git objects, not mutable checkout files.

## Independent preservation checks

Actual apps/packages inventory is exactly these four web files, with no API/contracts/config delta. The component's entire contiguous state/effect/persist/apiDraft/send/apply/undo implementation (from first input state through before JSX return) compares byte-for-byte with base. Therefore original failure handling, request IDs, send guards, draft conversion, storage, apply/undo state and effect deps remain unchanged, with no locale in request dependencies. The only new hook reads translator for render.

All ten QUICK_PROMPTS original Chinese strings independently compare exact in order with the new message fields. DOM keys and send arguments use these canonical message strings; translated labels do not replace outbound/history intents. User/model/message/suggestion/progress text remain raw. Model label interpolates raw modelId once. Eighteen new typed ZH/EN pairs cover eight fixed assistant labels/hints and ten quick-action labels; existing heading/apply keys are reused. Default Chinese copy is preserved, including punctuation and model-unavailable message. No label-based permissions, API identity or locale-driven send/storage effects are added.

Actual mounted scope was checked minimally: guided-research-flow mounts the helper in brief/directions/outline/search/report, with original session/step keys. Brief query uses pending-brief without saved session, consistent with new E2E's wsx.guidedResearch.skill.v1.pending-brief storage key. Floating assistant testid and actual launcher/heading controls match the new driver. This does not expand query to a saved-session/backend/model proof.

## Test/driver review

New provider suite preserves raw input DOM identity/focus/selection, ten canonical outbound intents, one pending request across locale changes, raw model/proposal/storage identity, explicit apply and undo, explicit failed-send retry and saved raw history. Anchored accessible-name selectors replace unsupported exact options in unit ByRoleOptions without weakening intent.

The entire original E2E file is an exact byte prefix of the new file; its real intake/session/report journey and assertions are untouched. The independent new180s case uses actual query UI and a controlled canonical HTTP route/schema, gates the first reply, preserves draft/selection/identity through locale changes, checks no extra sends on locale, pending/storage identity, explicit application+undo, a503 followed by explicit new-request retry with equal draft, and three total sends. Six capture calls ×375/1280 yield12 intended images; actual panel and button bounds are asserted. It makes no claim of model execution, saved research session or PostgreSQL validation. Original fixture authentication is retained; no credential output is introduced. Newroute and auxiliary-page cleanup remain in finally (pending gate released).

## Evidence and limits

The cited source-preservation-6c3760.json is not present in this exact head's tree. Preservation above was independently checked directly against base, without relying on that receipt. Author reports14 valid RED then six-suite51 GREEN and corrected14/type0; no commands were rerun by reviewer. Prior list CLI NoTests result and current exact-two-case list are not runtime success. Both browser cases and12 new screenshots are unverified dynamically here; no screenshot QA or backend/model/PG acceptance is claimed.

No tests/type/build/init/lint/browser/network/raw trace/log reads, commits, checkout or source writes performed. This is not B6 or whole research review.

## Exact source identities

- 100644 blob fc2bc9dc8c203fb54a2b34a68190ba93ca5419b1	apps/web/components/research-studio/guided-research-skill-assistant.tsx; SHA256 22d92e10bec86f3e216032319fbc7e0d4f4ccca3e186d3ee9dfe464dc32c938f
- 100644 blob a88ed427f049a40a66ed75631f498e5de1385e15	apps/web/lib/i18n/namespaces/research.ts; SHA256 87bb8e2f7d893fa89c72d7754808b6a72f7429e6c5921e5c33414b631d532dae
- 100644 blob 9f0b4270df58c4b8df333abb034cd7f8a698d98c	apps/web/tests/ui/guided-research-skill-assistant-i18n.test.tsx; SHA256 b5e1e35a9be742020025c3955d8c972c90f1763a256320620128071c357159f1
- 100644 blob add940f94ae1a4a9f66c14a81b9d669f1edfe1c0	apps/web/e2e/i18n-research-entry.spec.ts; SHA256 c1979e6cc71d657803f7c1208a8a0391162464433aa7ee040b352659b2836adc
