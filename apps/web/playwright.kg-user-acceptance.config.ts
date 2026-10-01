import path from "node:path";
import { defineConfig } from "@playwright/test";
import baseline from "./playwright.kg-experience-eval.config";

/** User-requested exploratory acceptance lane; leaves the frozen E1–E10 rubric intact. */
export default defineConfig({
  ...baseline,
  testDir: "./e2e",
  testMatch: /kg-(?:user|mode|levels)-acceptance\.acceptance\.ts$/,
  outputDir: "test-results/kg-user-acceptance/artifacts",
  reporter: [
    ["list"],
    ["json", { outputFile: "test-results/kg-user-acceptance/results.json" }],
    ["html", { outputFolder: "test-results/kg-user-acceptance/html", open: "never" }],
  ],
  use: {
    ...baseline.use,
    baseURL: process.env.KG_ACCEPTANCE_BASE_URL ?? `http://127.0.0.1:${process.env.WORKSPACEX_WEB_PORT}`,
    screenshot: "on",
    trace: "retain-on-failure",
    video: "off",
    actionTimeout: 20_000,
  },
  // The acceptance lane can reuse the baseline's independently owned stack.
  webServer: process.env.KG_ACCEPTANCE_EXTERNAL_STACK === "1" ? [] : (Array.isArray(baseline.webServer) ? baseline.webServer.map((server) => ({
    ...server,
    command: server.command.includes("seed-kg-experience-eval.ts")
      ? server.command.replace("seed-kg-experience-eval.ts", "seed-kg-experience-eval.ts && pnpm --filter @repo/api exec tsx scripts/seed-kg-mode-acceptance.ts")
      : server.command,
  })) : baseline.webServer),
  metadata: { acceptanceStandard: path.resolve(__dirname, "../../docs/testing/knowledge-graph-user-acceptance.md") },
});
