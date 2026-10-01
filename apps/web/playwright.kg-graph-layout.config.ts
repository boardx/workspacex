import { defineConfig } from "@playwright/test";
import acceptance from "./playwright.kg-user-acceptance.config";
export default defineConfig({
  ...acceptance,
  testMatch: /kg-graph-layout\.acceptance\.ts$/,
  outputDir: "test-results/kg-graph-layout/artifacts",
  reporter: [["list"], ["json", { outputFile: "test-results/kg-graph-layout/results.json" }]],
});
