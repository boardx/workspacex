import { defineConfig } from "@playwright/test";
const args = process.argv.slice(2);
// Only the pure discovery invocation is exempt: an option value named --list is not listing.
const listingOnly = (args.length === 4 || args.length === 5 && args[4] === "--reporter=json")
  && args[0] === "test" && args[1] === "--config"
  && args[2] === "playwright.skill-files.config.ts" && args[3] === "--list";
if (!listingOnly && process.env.STUDIO_LANE !== "1") throw new Error("Enable this lane explicitly with STUDIO_LANE=1; use scripts/studio-skill-files-e2e.mjs for local isolation.");
if (!listingOnly && (!process.env.E2E_BASE_URL || !process.env.STUDIO_API_BASE_URL || !process.env.STUDIO_EVIDENCE_DIR)) throw new Error("STUDIO lane requires web/API origins and an evidence directory.");
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
