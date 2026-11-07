# PR #5912 interview browser regression evidence

2026-10-24 Asia/Shanghai. CI run 39989821280 failed three interview browser cases because they still selected the removed global `展开答案` button. The current product contract independently collapses question answers behind each question title; records with no question show their context directly. No product change or invented document/hash attributes was required.

Updated `digital-interview-research-quality.spec.ts` retains saved execution progress, insight/source attribution, filtering, reload, responsive geometry, streaming/navigation, failed repair and candidate refresh assertions. It now verifies question-level collapse, expansion and reload reset; context-only fixtures explicitly have no question toggle. Added a component integration test covering persisted progress/insights while an answer is collapsed, source links and unchanged source document/version/hash.

## Component verification

```sh
pnpm --filter web exec vitest run tests/ui/interview-source-runs.test.tsx tests/ui/interview-question-answers.test.tsx
```

Result: 26 passed (24 source-runs, 2 question-answers).

## Real Chromium verification

```sh
pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter web exec playwright test --config playwright.fullstack-smoke.config.ts --project=seeded e2e/digital-interview-research-quality.spec.ts --grep 'saved execution metadata|report stream keeps|report repair retains' --workers=1
```

Result: 2 passed, exit 0, total 4m33s. The initial stream regex `keeps` did not match its actual title; this run proves only the saved execution/reload and report repair/failure/refresh cases. Full log `/tmp/cn-auto-interview-browser.log`, preserved first-run artifacts `/tmp/cn-auto-interview-browser-first-results`.

```sh
pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter web exec playwright test --config playwright.fullstack-smoke.config.ts --project=seeded e2e/digital-interview-research-quality.spec.ts --grep 'report stream exposes' --workers=1
```

Result: 1 passed, exit 0, total 4m22s. Proves partial output before completion and stage navigation. Full log `/tmp/cn-auto-interview-stream-browser.log`.

Both runs built this source using `next build` and started isolated API/Postgres/Redis/Minio services. These three browser cases deliberately use HTTP/session and NDJSON fixtures, so they prove browser interaction and streaming UI recovery, not real-model quality, genuine authentication or database persistence.

## Resource cleanup

The isolation wrapper executed its own `docker compose ... down -v` after each run (1s cleanup each). These checks each returned exit 0 with no remaining container names:

```sh
docker ps -a --filter label=com.docker.compose.project=wsx-aba5c7fcf6932463f1c9 --format '{{.Names}}'
docker ps -a --filter label=com.docker.compose.project=wsx-404b4cac43fe7aa8f185 --format '{{.Names}}'
```

No other stack was stopped or changed.

## Retained screenshots

- [Saved transcript after reload, mobile](interview-browser/saved-runs-mobile.png)
- [Saved report candidate retained after failed repair and reload](interview-browser/report-repair-refresh-retained.png)
- [Stream partial output before completion](interview-browser/report-stream-partial.png)
