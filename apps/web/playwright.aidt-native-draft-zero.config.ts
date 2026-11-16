import { defineConfig } from "@playwright/test";
import { REAL_MODEL_SMOKE } from "./e2e/real-model-smoke-fixture";

/** Externally owned zero-executor window only; this configuration starts no services. */
export default defineConfig({
  testDir: "./e2e", testMatch: ["aidt-native-draft-zero.spec.ts"], workers: 1, retries: 0, timeout: 150_000,
  expect: { timeout: 5_000 },
  use: { baseURL: REAL_MODEL_SMOKE.baseUrl, actionTimeout: 30_000, navigationTimeout: 60_000,
    trace: "off", screenshot: "off", video: "off", viewport: { width: 1440, height: 1000 } },
  reporter: [["list"], ["json", { outputFile: `${process.env.AIDT_NATIVE_DRAFT_OUTPUT_DIR ?? "test-results/aidt-native-draft-zero"}/results.json` }]],
  outputDir: process.env.AIDT_NATIVE_DRAFT_OUTPUT_DIR ?? "test-results/aidt-native-draft-zero",
});
