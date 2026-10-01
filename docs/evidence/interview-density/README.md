# Interview populated-density evidence (#4544)

`apps/web/e2e/digital-interview-research-quality.spec.ts` creates deterministic, canonical Markdown browser fixtures and writes review screenshots in this directory: six-card list, four-card analysis, and the long report at desktop and phone widths. The report's top/table/end are separate viewport captures because the sticky header and inner scrolling region make a single element screenshot misleading. The source responses in that test are intercepted, so those screenshots prove only rendering and navigation. `apps/web/e2e/digital-interview-density-live.spec.ts` separately tests real Chromium → Next proxy → API → PostgreSQL persistence and reload with no page routes.

Run both with:

```bash
pnpm exec tsx .harness/scripts/with-test-isolation.ts -- pnpm --filter web exec playwright test --config playwright.fullstack-smoke.config.ts --project=seeded 'digital-interview-(research-quality|density-live).spec.ts' --reporter=line
```

Measurements encoded as browser assertions: list search width ≥500 px; six list cards; four analysis cards with first-row y difference <24 px; five outline groups; six execution tabs; eight report TOC entries; report body ≥16 px; no page overflow at 768/390 px; report paragraph/list/table bounds stay within the document. The long report contains 25+ visible content blocks and an actual GFM table. The real persistence test asserts raw Markdown byte equality and version equality after reload.

Verified on the #4544 diff before commit in isolated Chromium runs (2026-09-28): visual density 1/1 passed, live API/DB persistence 1/1 passed; `pnpm --filter web exec vitest run interview --reporter=dot` 27 files/163 tests passed; web typecheck and lint exit 0. A first long-report browser run was RED because blank lines between table rows prevented GFM table parsing; it was fixed in the fixture, not by removing the table assertion. Earlier RED layout measurements were 131 px between the first two analysis cards and 13 px report body; the same assertions are green on this diff.

This is not pixel-perfect signoff. Simulated expert claims are not real participant evidence.
