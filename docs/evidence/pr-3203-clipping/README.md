# PR 3203 zero-clipping repair (issue 3236)

Base: `3cc01c302b259a0f8375de8570aafd3f7c47dc3d`. Independent review BLOCK: clipping could be compensated by the weighted total, and the collector missed vertical clipping. This patch adds an independent zero-clipping gate and checks hidden/clip overflow on both axes. Horizontal ellipsis is allowed; it does not excuse vertical truncation. Scrollable and visible overflow is not classified as clipping. Scoring weights, thresholds and CI policy are unchanged.

Validation on 2026-09-09:

- Existing collector + six real Chromium DOM cases: 3 failed / 3 passed. Failures identified vertical clipping, vertical clipping with text-overflow:ellipsis, and false-positive visible overflow.
- Fixed collector and hard gate: `CI=true pnpm --filter web exec playwright test --config playwright.prototype-audit.config.ts`: 12/12 passed (six original application scenes and six DOM cases), 43.5s; original scene minimum score 89. Used the checked-in webServer configuration; Google Font requests retried before tests ran, no font mock or clipping exemption.
- `pnpm --filter web exec vitest run tests/ui/prototype-audit-metrics.test.ts`: 20/20 passed. Tests explicitly demonstrate that one/four clipped nodes can retain a passing weighted score yet are rejected by the hard gate.
- Counterproof: temporarily replacing assertNoClipping with a no-op produced 3 failures / 17 passes; restored original source and reran 20/20 green.
- `pnpm --filter web exec tsc --noEmit`, targeted ESLint, `git diff --check`, and `./init.sh` quick baseline passed.

Raw local outputs are `/tmp/pr3203-clipping-{before-dom,after-dom,full,unit,counterproof,lint,init}.log`; no raw logs or runtime payloads are committed. Independent review and hosted CI remain required; no merge/deployment claim.
