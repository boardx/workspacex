import { defineConfig } from "@playwright/test";

const port = Number(process.env.WORKSPACEX_WEB_PORT);
if (!process.env.WORKSPACEX_ISOLATION_ID || !Number.isInteger(port) || port < 1 || !process.env.AIDT_LOCAL_DATA_DIR) {
  throw new Error("Run this opt-in acceptance through with-test-isolation and set AIDT_LOCAL_DATA_DIR.");
}
const outputDir = process.env.AIDT_LOCAL_OUTPUT_DIR ?? "test-results/aidt-local-persistence";
const webMode = process.env.AIDT_LOCAL_WEB_MODE ?? "dev";
if (webMode !== "dev" && webMode !== "start") throw new Error("AIDT_LOCAL_WEB_MODE must be dev or start.");
export default defineConfig({
  testDir: "./e2e", testMatch: "aidt-local-persistence.spec.ts", workers: 1, retries: 0,
  timeout: webMode === "start" ? 1_800_000 : 900_000, outputDir,
  reporter: [["list"], ["json", { outputFile: `${outputDir}/results.json` }]],
  // This lane uses the native persistent controller, never the fullstack fixtures.
  // Login is never traced. The spec may keep a private post-login diagnostic trace.
  use: { baseURL: `http://127.0.0.1:${port}`, headless: true, actionTimeout: 30_000, navigationTimeout: 60_000, trace: "off", screenshot: "only-on-failure" },
});
