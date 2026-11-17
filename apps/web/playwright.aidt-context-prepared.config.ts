import { defineConfig } from "@playwright/test";
import { REAL_MODEL_SMOKE } from "./e2e/real-model-smoke-fixture";

/** External A1-owned stack with executor autostart explicitly disabled. Never starts a service. */
export default defineConfig({ testDir: "./e2e", testMatch: ["aidt-v2-context-prepared.spec.ts"], workers: 1, retries: 0, timeout: 90000,
  expect: { timeout: 5000 }, use: { baseURL: REAL_MODEL_SMOKE.baseUrl, actionTimeout: 30000, navigationTimeout: 60000, trace: "off", screenshot: "off", video: "off", viewport: { width: 1440, height: 1000 } },
  reporter: [["list"], ["json", { outputFile: `${process.env.AIDT_V2_OUTPUT_DIR ?? "test-results/aidt-context-prepared"}/results.json` }]],
  outputDir: process.env.AIDT_V2_OUTPUT_DIR ?? "test-results/aidt-context-prepared",
});
