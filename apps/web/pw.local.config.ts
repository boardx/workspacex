import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  outputDir: "test-results/trace-geometry",
  testDir: "./e2e",
  testMatch: /chat-trace-.*-(geometry|liveness)\.spec\.ts$/,
  reporter: "list",
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], launchOptions: { executablePath: "/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell" } } }],
});
