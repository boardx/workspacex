import { defineConfig } from "@playwright/test";
import { REAL_MODEL_SMOKE } from "./e2e/real-model-smoke-fixture";

/** Externally owned, isolated real stack. This config never starts a competing server. */
export default defineConfig({
  testDir: "./e2e",
  testMatch: ["aidt-v2-*.spec.ts"],
  testIgnore: ["aidt-v2-context-prepared.spec.ts"],
  workers: 1,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL: REAL_MODEL_SMOKE.baseUrl,
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
    trace: "off",
    screenshot: "off",
    video: "off",
    viewport: { width: 1440, height: 1000 },
  },
  reporter: [["list"], ["json", { outputFile: `${process.env.AIDT_V2_OUTPUT_DIR ?? "test-results/aidt-v2"}/results.json` }]],
  outputDir: process.env.AIDT_V2_OUTPUT_DIR ?? "test-results/aidt-v2",
});
