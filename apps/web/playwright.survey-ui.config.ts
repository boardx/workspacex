import { defineConfig } from "@playwright/test";
import fullstack from "./playwright.fullstack-smoke.config";

// Local survey UI acceptance keeps the real isolated API/seed/auth services,
// while compiling only visited pages. Production-build results stay separate.
const servers = Array.isArray(fullstack.webServer) ? fullstack.webServer : [];
const webPort = process.env.WORKSPACEX_WEB_PORT;
if (!webPort) throw new Error("Run survey UI acceptance through with-test-isolation.ts");

export default defineConfig({
  ...fullstack,
  outputDir: "test-results/survey-ui-5840",
  globalSetup: "./e2e/survey-ui-warmup.ts",
  webServer: servers.map(server => server.url === `http://127.0.0.1:${webPort}/login`
    ? {
      ...server,
      command: `next dev -p ${webPort}`,
      env: { ...server.env, NEXT_DIST_DIR: ".next-survey-ui-e2e" },
    }
    : server),
});
