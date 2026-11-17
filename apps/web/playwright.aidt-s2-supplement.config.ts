import { defineConfig } from "@playwright/test";
import { REAL_MODEL_SMOKE } from "./e2e/real-model-smoke-fixture";
export default defineConfig({
  testDir: "./e2e", testMatch: ["aidt-v2-s2-supplement.spec.ts"], workers: 1, retries: 0, timeout: 390_000,
  expect: { timeout: 5_000 }, use: { baseURL: REAL_MODEL_SMOKE.baseUrl, actionTimeout: 30_000, navigationTimeout: 60_000,
    trace: "off", screenshot: "off", video: "off", viewport: { width: 1440, height: 1000 } },
  reporter: [["list"], ["json", { outputFile: `${process.env.AIDT_V2_OUTPUT_DIR ?? "test-results/aidt-s2-supplement"}/results.json` }]],
  outputDir: process.env.AIDT_V2_OUTPUT_DIR ?? "test-results/aidt-s2-supplement",
});
