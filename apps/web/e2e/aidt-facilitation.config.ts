/** Test selection/privacy adapter only: the existing real-model lane owns all server setup. */
import path from "node:path";
import { defineConfig } from "@playwright/test";
import base from "../playwright.real-model-smoke.config";
import { REAL_MODEL_SMOKE } from "./real-model-smoke-fixture";
const servers = base.webServer ? (Array.isArray(base.webServer) ? base.webServer : [base.webServer]) : undefined;
export default defineConfig({
  ...base,
  testDir: __dirname,
  projects: [{ name: "real-model-aidt-facilitation", testMatch: ["real-model-aidt-facilitation.spec.ts"] }],
  use: { ...base.use, trace: "off", screenshot: "off", video: "off" },
  // Match the original config directory when its inherited local webServer is used.
  ...(servers ? { webServer: servers.map(server => ({ ...server, cwd: server.cwd ?? path.resolve(__dirname, "..") })) } : {}),
  reporter: [["list"], ["json", { outputFile: path.resolve(REAL_MODEL_SMOKE.evidenceDir, "aidt-facilitation", "playwright-report.json") }]],
});
