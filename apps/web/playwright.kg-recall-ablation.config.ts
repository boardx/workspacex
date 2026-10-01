import { defineConfig } from "@playwright/test";
import baseline from "./playwright.kg-experience-eval.config";
export default defineConfig({
  ...baseline,
  testDir: "./e2e",
  testMatch: /kg-recall-ablation\.acceptance\.ts$/,
  outputDir: "test-results/kg-recall-ablation/artifacts",
  reporter: [["list"], ["json", { outputFile: "test-results/kg-recall-ablation/results.json" }]],
  use: { ...baseline.use, screenshot: "on", trace: "retain-on-failure" },
});
