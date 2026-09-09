import { defineConfig } from "@playwright/test";
if (process.env.STUDIO_LANE !== "1") throw new Error("Enable this lane explicitly with STUDIO_LANE=1; use scripts/studio-skill-files-e2e.mjs for local isolation.");
if (!process.env.E2E_BASE_URL || !process.env.STUDIO_API_BASE_URL || !process.env.STUDIO_EVIDENCE_DIR) throw new Error("STUDIO lane requires web/API origins and an evidence directory.");
export default defineConfig({
  testDir: "./e2e", testMatch: "skill-file-pin-live.spec.ts",
  workers: 1, fullyParallel: false, retries: 0, timeout: 300_000,
  expect: { timeout: 30_000 }, reporter: [["list"], ["json", { outputFile: `${process.env.STUDIO_EVIDENCE_DIR}/playwright-report.json` }]],
  outputDir: process.env.STUDIO_EVIDENCE_DIR,
  use: { baseURL: process.env.E2E_BASE_URL, browserName: "chromium", headless: true,
    viewport: { width: 1440, height: 1000 }, screenshot: "only-on-failure",
    // Trace archives include auth request headers; never record session tokens in this lane.
    trace: "off" },
});
