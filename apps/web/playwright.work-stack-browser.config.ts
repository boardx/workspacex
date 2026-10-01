import { defineConfig } from "@playwright/test";
import fullstack from "./playwright.fullstack-smoke.config";

// Reuse the isolated real-service seed and upstream wiring; do not duplicate infra.
const webPort = process.env.WORKSPACEX_WEB_PORT!;
const distDir = ".next-work-stack-browser";
const executablePath = process.env.WORK_STACK_BROWSER_EXECUTABLE_PATH;
// Keep large build caches on a separately provisioned test volume when needed.
const buildCacheDir = process.env.WORK_STACK_BROWSER_BUILD_CACHE_DIR;
const quoteShell = (value: string) => "'" + value.replaceAll("'", "'\"'\"'") + "'";
const prepareBuildCache = buildCacheDir
  ? `mkdir -p ${distDir} ${quoteShell(buildCacheDir)} && work_stack_build_cache=$(mktemp -d ${quoteShell(`${buildCacheDir}/build.XXXXXXXX`)}) && ln -s "$work_stack_build_cache" ${distDir}/cache && `
  : "";
const servers = (
  Array.isArray(fullstack.webServer) ? fullstack.webServer : [fullstack.webServer]
).filter((server) => server !== undefined).map((server) => {
  if (server.url !== `http://127.0.0.1:${webPort}/login`) return server;
  return {
    ...server,
    command: `rm -rf ${distDir} && ${prepareBuildCache}next build && next start -p ${webPort}`,
    env: { ...server.env, NEXT_DIST_DIR: distDir },
  };
});

export default defineConfig({
  ...fullstack,
  projects: [
    { name: "work-stack-digital-human", testMatch: ["digital-human-journey.spec.ts"] },
    {
      name: "work-stack-workflow",
      testMatch: ["w029-browser-journey.spec.ts"],
      dependencies: ["work-stack-digital-human"],
    },
  ],
  workers: 1,
  fullyParallel: false,
  // Imports persist within a run; a retry cannot restore the initial pending pack state.
  retries: 0,
  expect: { ...fullstack.expect, timeout: 30_000 },
  outputDir: "test-results/work-stack-browser",
  reporter: [["list"], ["json", { outputFile: "test-results/work-stack-browser-summary.json" }]],
  use: {
    ...fullstack.use,
    launchOptions: {
      ...fullstack.use?.launchOptions,
      ...(executablePath ? { executablePath } : {}),
    },
    trace: "on",
    screenshot: "on",
  },
  webServer: servers,
});
