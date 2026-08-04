import { defineConfig, devices } from "@playwright/test";
import { FULLSTACK_E2E } from "./e2e/fullstack-smoke-fixture";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required; run through the root #74 isolation wrapper`);
  return value;
}

const apiPort = required("WORKSPACEX_API_PORT");
const webPort = required("WORKSPACEX_WEB_PORT");
const apiOrigin = process.env.FULLSTACK_E2E_MODE === "wrong-api-origin"
  ? "http://127.0.0.1:1"
  : `http://127.0.0.1:${apiPort}`;
const apiPgPort = process.env.FULLSTACK_E2E_MODE === "database-unavailable" ? "1" : required("PGPORT");
const breakController = process.env.FULLSTACK_E2E_MODE === "broken-controller-route" ? "artifacts" : "";
const compose = `docker compose -f ../api/docker-compose.dev.yml -p "${required("COMPOSE_PROJECT_NAME")}"`;
const fixtureEnv = {
  FULLSTACK_E2E_FIXTURE: "1",
  FULLSTACK_E2E_EMAIL: FULLSTACK_E2E.email,
  FULLSTACK_E2E_PASSWORD: FULLSTACK_E2E.password,
  FULLSTACK_E2E_ORG_ID: FULLSTACK_E2E.orgId,
  FULLSTACK_E2E_USER_ID: FULLSTACK_E2E.userId,
  FULLSTACK_E2E_PROJECT_ID: FULLSTACK_E2E.projectId,
  FULLSTACK_E2E_PROJECT_NAME: FULLSTACK_E2E.projectName,
  FULLSTACK_E2E_ARTIFACT_ID: FULLSTACK_E2E.artifactId,
  FULLSTACK_E2E_SENTINEL_FILE: FULLSTACK_E2E.sentinelFile,
};

export default defineConfig({
  testDir: "./e2e",
  testMatch: "fullstack-smoke.spec.ts",
  fullyParallel: false,
  retries: 0,
  reporter: process.env.CI
    ? [["line"], ["json", { outputFile: "test-results/fullstack-smoke.json" }]]
    : "list",
  use: {
    baseURL: `http://127.0.0.1:${webPort}`,
    ...devices["Desktop Chrome"],
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: [
        `${compose} up -d --wait postgres redis minio`,
        "pnpm --filter @repo/api exec tsx scripts/seed-fullstack-smoke.ts",
        `PGPORT=${apiPgPort} pnpm --filter @repo/api start`,
      ].join(" && "),
      url: `http://127.0.0.1:${apiPort}/healthz`,
      timeout: process.env.FULLSTACK_E2E_MODE === "database-unavailable" ? 20_000 : 120_000,
      reuseExistingServer: false,
      env: { ...process.env, ...fixtureEnv, PORT: apiPort },
    },
    {
      command: `next dev -p ${webPort}`,
      url: `http://127.0.0.1:${webPort}/login`,
      timeout: 120_000,
      reuseExistingServer: false,
      env: {
        ...process.env,
        NEXT_PUBLIC_API_URL: `http://127.0.0.1:${webPort}`,
        NEXT_PUBLIC_API_PATH_PREFIX: "/__fullstack_api",
        FULLSTACK_E2E_API_ORIGIN: apiOrigin,
        FULLSTACK_E2E_BREAK_CONTROLLER: breakController,
        NEXT_DIST_DIR: ".next-fullstack-e2e",
      },
    },
  ],
});
