import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: ".", testMatch: "research-route-continuity.spec.ts", workers: 1, retries: 0,
  timeout: 120000, use: { baseURL: "http://127.0.0.1:3296", viewport: { width: 1280, height: 900 }, trace: "retain-on-failure" },
  outputDir: "../../../docs/evidence/research-route-5969/browser-results",
  webServer: { command: "NEXT_DIST_DIR=.next-research-5969 pnpm exec next dev -p 3296 -H 127.0.0.1", cwd: ".", url: "http://127.0.0.1:3296/research/new", reuseExistingServer: false, timeout: 180000 },
});
