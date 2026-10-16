import { defineConfig } from "@playwright/test";
import base from "./playwright.fullstack-smoke.config";

// Same reserved fixture/API/PG and lifecycle as fullstack smoke; dev compilation
// avoids rebuilding the production bundle for each separately audited UX round.
const servers = Array.isArray(base.webServer) ? base.webServer : [base.webServer!];
const production = process.env.WX_RESEARCH_UX_PRODUCTION === "1";
export default defineConfig({
  ...base,
  workers: 1,
  // Independent R4 delivery tests only its own round by default. The full
  // R1/R2/R3/R4 suite requires the explicitly assembled product-fix combination.
  grep: process.env.WX_RESEARCH_UX_ALL === "1" ? undefined : /R4 /,
  outputDir: "test-results/research-ux",
  projects: [{ ...base.projects?.find(project => project.name === "seeded"), name: "research-ux", testMatch: "research-ux-rounds.spec.ts" }],
  webServer: production ? servers : servers.map((server, index) => index === servers.length - 1 ? {
    ...server,
    command: `next dev -H 127.0.0.1 -p ${process.env.WORKSPACEX_WEB_PORT}`,
    env: { ...server.env, NEXT_DIST_DIR: ".next-research-ux-5780" },
  } : server),
});
