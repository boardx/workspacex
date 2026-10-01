# Official digital-human browser journey

Spec: `apps/web/e2e/digital-human-journey.spec.ts`.

This is a real browser/API/PostgreSQL acceptance journey with the existing deterministic upstream model. It does not intercept requests, create successful run fixtures, modify official role snapshots, or assert model-generated capability wording.

The real form logs in the fullstack administrator, opens the platform Agent catalog, enables the offered official role pack through its UI, observes actual successful dependency import responses, and checks published directory persistence. A separate browser context logs in the seeded member and selects D002, D003, D005 and D011 in four separate authoritative threads. Each actual AGUI completion is matched to the persisted run, pinned agent/version/provider/model, stored message, and visible reply; refreshing must recover the exact same stored reply without duplication. Sales workflow/CRM execution is excluded by user authorization. Other offered roles are enabled and displayed according to the actual package, not hidden to force a four-role count.

The spec captures each journey stage with `testInfo.outputPath` PNGs, attaches observed import coordinates/status and persisted run identifiers, enables the normal Playwright trace; the member uses the normal Playwright context trace. Synthetic fixture accounts and created test threads only are used. Artifacts are local test evidence, not an authorization to publish session traces.

## Local orchestration

Run `pnpm run verify:work-stack-browser` for the dedicated isolated production-build lane; see [the lane README](../work-stack-browser/README.md). The normal fullstack config also registers `official-digital-human` after seeded and board-regression checks, then `official-role-workflow`, then GitHub import. The dedicated lane runs the two journeys serially with one worker and no retries. Imports change catalogs: each complete rerun needs a fresh isolation seed. Already imported roles intentionally fail the pending-role assertions rather than fabricating an enable operation.

The official package pins `dashscope / qwen-plus`. The existing loopback-only alias mechanism needs `KERNEL_LOOPBACK_PROVIDER_ALIASES=dashscope` on the API process, with the existing `KERNEL_MODEL_PROVIDER=fullstack-loopback` and a loopback `KERNEL_MODEL_BASE_URL`. The alias does not override registered providers and is ignored for remote endpoints. The existing kernel route may execute tool-capable roles through the deep-agent loopback upstream while preserving their stored `dashscope / qwen-plus` snapshot. No production provider validation is weakened.

Example execution (the parent owns startup and the config):

```sh
pnpm --filter web exec playwright test --config <local-derived-fullstack-config> digital-human-journey.spec.ts --workers=1 --retries=0
```

## Verification state

Round 7 execution is reported by the parent as **PASS** for D002/D003/D005/D011: actual production Next → Nest → isolated PostgreSQL/Redis, real portrait directory/detail pages, UI-created independent conversations, AGUI execution, server-persisted replies, and identical replies recovered after refresh. Source baseline: `5b698e315`. No API interception replaces these routes. The parent owns the screenshots, traces and final consolidated evidence report; this documentation update does not fabricate attachments or declare real-model acceptance.

This passing run proves basic role use, orchestration and persistence with deterministic upstream responses. D005 basic discovery/detail/chat remains in scope; only complete sales workflows/CRM are **DEFERRED**. Real-model role fidelity, real PDF analysis, deployed devapp and real audio acceptance remain **BLOCKED**, not PASS.
