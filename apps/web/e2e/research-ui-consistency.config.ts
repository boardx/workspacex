import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".", testMatch: "research-ui-consistency.spec.ts", workers: 1, retries: 0,
  timeout: 180000, use: { navigationTimeout: 120000, baseURL: "http://127.0.0.1:3284", viewport: { width: 1280, height: 900 }, trace: "retain-on-failure" },
  outputDir: "../../../docs/evidence/research-ui-5841/browser-results",
  webServer: { command: "NEXT_DIST_DIR=.next-research-5841 pnpm exec next dev -p 3284 -H 127.0.0.1", cwd: ".", url: "http://127.0.0.1:3284/research/new", reuseExistingServer: process.env.RESEARCH_UI_5841_OWNED_SERVER === "1", timeout: 300000 },
});
