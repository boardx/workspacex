import { defineConfig } from "@playwright/test";
import fullstack from "./playwright.fullstack-smoke.config";

// Reuse the canonical real API/DB/login orchestration in an isolated run.
export default defineConfig({
  ...fullstack,
  outputDir: "test-results/entity-localization",
  projects: [{ name: "entity-localization", testMatch: "entity-localization.spec.ts" }],
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 20_000 },
});
