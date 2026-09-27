# Real Fabric touch counterproof (component scope only)

Root rendered the unmocked production `BoardFabricSurface` with React and Fabric in Chromium, using an ephemeral in-memory bundle and a loopback HTTP server. No Docker, API, Yjs server, database, or physical device was involved. Browser/server are closed in finally.

At clean integrated baseline `095b936c8`, CDP touch drag from (300,300) to (380,340) emitted viewport attributes x=NaN, y=NaN, zoom=1. Probe exited 1. This reproduces the production input defect rather than merely detecting a missing test.

At clean candidate `d1f077ef2785b41fdf0c013ba81920fca0861704`, the same drag emitted x=80, y=40, zoom=1 with no page errors; probe exited 0. Root checked the tree was clean immediately after this bounded pan probe. Independent review subsequently found Fabric cancellation lifecycle cleanup incomplete, so this candidate is NOT approved for integration on the strength of pan alone.

The attached probe was then expanded to check cancellation, a new contact ID, mouse regression, variable CDP pen pressure, and optional `--pinch`. Expanded runs on an actively edited candidate tree are diagnostic only and are not credited to the clean SHA. Full expanded exact-SHA acceptance remains pending. `--pinch` demands a 1.8x zoom with preserved world anchor, not just any changed viewport value.

Usage: `node fabric-touch-component-probe.cjs /absolute/worktree --pinch`. Uses that worktree's installed Playwright, React, Fabric and esbuild (via Vitest). These component checks supplement, never replace, full Board browser/API/database/collaboration acceptance or physical touch/pen evidence.
