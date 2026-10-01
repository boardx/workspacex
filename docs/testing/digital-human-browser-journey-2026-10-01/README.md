# Official digital-human browser journey

Spec: `apps/web/e2e/digital-human-journey.spec.ts`.

This is a real browser/API/PostgreSQL acceptance journey with the existing deterministic upstream model. It does not intercept requests, create successful run fixtures, modify official role snapshots, or assert model-generated capability wording.

The real form logs in the fullstack administrator, opens the platform Agent catalog, enables the offered official role pack through its UI, observes actual successful dependency import responses, and checks published directory persistence. A separate browser context logs in the seeded member and selects D002, D003 and D011 in three separate authoritative threads. Each actual AGUI completion is matched to the persisted run, pinned agent/version/provider/model, stored message, and visible reply; refreshing must recover the exact same stored reply without duplication. Sales workflow/CRM execution is excluded by user authorization. Other offered roles are enabled and displayed according to the actual package, not hidden to force a four-role count.

The spec captures each journey stage with `testInfo.outputPath` PNGs, attaches observed import coordinates/status and persisted run identifiers, enables the normal Playwright trace, and captures the member context separately in `member-trace.zip`. Synthetic fixture accounts and created test threads only are used. Artifacts are local test evidence, not an authorization to publish session traces.

## Local orchestration

Use the parent's local derived fullstack-smoke config; no root scripts or CI/fullstack configuration were changed here. The config must select this filename explicitly, retain the real fullstack seed/API/database/Next server, and run one worker in a fresh isolated database. Imports change shared catalogs, so this journey must run after existing empty-catalog checks or independently with its own fresh seed. If the roles start already imported, the pending-role assertions intentionally fail rather than fabricating an enable operation.

The official package pins `dashscope / qwen-plus`. The existing loopback-only alias mechanism needs `KERNEL_LOOPBACK_PROVIDER_ALIASES=dashscope` on the API process, with the existing `KERNEL_MODEL_PROVIDER=fullstack-loopback` and a loopback `KERNEL_MODEL_BASE_URL`. The alias does not override registered providers and is ignored for remote endpoints. The existing kernel route may execute tool-capable roles through the deep-agent loopback upstream while preserving their stored `dashscope / qwen-plus` snapshot. No production provider validation is weakened.

Example execution (the parent owns startup and the config):

```sh
pnpm --filter web exec playwright test --config <local-derived-fullstack-config> digital-human-journey.spec.ts --workers=1 --retries=0
```

## Verification state

Only TypeScript syntax transpilation and `git diff --check` were performed while preparing this spec. Browser execution, integration typechecking, screenshots and traces are **NOT RUN / NOT PRODUCED** at this commit. The parent will run the stack and inspect resulting evidence. A loopback run passing these assertions proves orchestration and persistence only. Real-model role fidelity, real PDF analysis quality, and deployed devapp acceptance remain **BLOCKED** by missing model credentials/online authenticated evidence.
