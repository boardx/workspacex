import { defineConfig } from "@playwright/test";

/** Actual React/DOM counterexamples; deliberately no webServer, API, database or auth. */
export default defineConfig({
  testDir: "./e2e",
  testMatch: /(chat-task-workbench-empty-state|agent-workbench-scroll-acceptance)\.spec\.ts$/,
  grep: /PAPER-layout|small-overflow upward intent/,
  workers: 1,
  retries: 0,
  expect: { timeout: 3_000 },
  reporter: "list",
  outputDir: "test-results/paper-layout",
  use: { headless: true, screenshot: "only-on-failure" },
});
