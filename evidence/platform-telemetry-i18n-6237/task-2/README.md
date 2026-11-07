Real telemetry acceptance at 3e7e579cea24ab9b1effdabb408c453fd571cc8d
=================================================================

One actual browser case passed in24.569s; native command335.128s and isolation wrapper339.475s include the original production build/startup. Retry/skip/flaky/unexpected/global errors:0. Owned containers, volumes and all13 reserved ports were checked empty before releasing peers, before report parsing or image QA.

All16 final375x900/1280x900 PNGs were individually viewed by root: initial consent EN/ZH, changed consent EN, last report EN/ZH, designated operator EN, ordinary denial EN, revoked denial EN. Consent labels/consequences/controls and both denial panels are readable without overlap/global overflow. Raw JSON uses the existing internal scroller: its long mobile installation-ID line is horizontally scrollable, the native case reaches each overflowing axis end and returns, and exact raw JSON text is compared separately. Viewport PNGs are not a full-report-text export. Only inspected images with IHDR/IDAT/IEND chunks are included; no password/token/cookie/installation secret or raw trace is published.

The real journey uses native UI login, actual protected PUT with exact one-key bodies for every flag, independent GET readback and reload, locale changes without extra telemetry calls/control replacement, actual operator grant/login/revoke and ordinary/revoked403 with unchanged consent. The failed report history is synthetic persisted read input, and the isolated reporter is globally disabled. This does not prove any actual sending or external model behavior.

Reproduce from the repository root (original120s case/20s expect, one worker, zero retries; --no-deps excludes unrelated ordering tests while preserving canonical webServer/seed):

```sh
pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter web exec playwright test --config playwright.fullstack-smoke.config.ts --project=seeded-github-import --no-deps e2e/entity-localization.spec.ts --grep "platform telemetry preserves independent consent and original history across locales and real operator boundaries$" --workers=1 --retries=0 --max-failures=1
```

Source review passed after the retained new DOM typing failure was repaired. Original11 nonimport statements,77 fixtureEnv values, actor fixture bytes/import order and Task1 source/tests remain preserved. Configuration tests20PASS retain the existing Vite CJS deprecation. Two private discovery mistakes and their actual selection/exit outcomes are retained in retained-failures.json; neither ran a browser. Raw native logs/reports/traces remain private. Independent runtime review passed at this source with no actionable P1/P2; the reviewer independently checked the raw report, all16 image hashes/dimensions and three individual mobile images. Final whole-branch review passed at22a699e909f38664991e0be430fa84c88d88a267 with product bytes identical to native source3e7e579cea24ab9b1effdabb408c453fd571cc8d. Publication and main-owned CI/actual integration remain pending until separately recorded.

Native webServer output retains Node color-environment warnings (NO_COLOR with FORCE_COLOR) and DEP0060 util._extend deprecation. These are not global test errors; output is not described as stderr-free and no warning was suppressed.
