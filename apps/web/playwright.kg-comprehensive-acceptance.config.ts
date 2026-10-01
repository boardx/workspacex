import { defineConfig } from "@playwright/test";
import acceptance from "./playwright.kg-user-acceptance.config";

/** Frozen E1–E10 plus user journeys and graph layout, with one real browser/API/DB stack. */
export default defineConfig({
  ...acceptance,
  testMatch: [/kg-(?:user|mode|levels)-acceptance\.acceptance\.ts$/, /kg-graph-layout\.acceptance\.ts$/, /kg-experience-eval\/.*\.eval\.ts$/],
  outputDir: "test-results/kg-comprehensive-acceptance/artifacts",
  reporter: [["list"], ["json", { outputFile: "test-results/kg-comprehensive-acceptance/results.json" }], ["html", { outputFolder: "test-results/kg-comprehensive-acceptance/html", open: "never" }]],
});
