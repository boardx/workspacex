import { defineConfig, devices } from "@playwright/test";
import { CHAT_READ_E2E } from "./e2e/chat-read-fixture";

const apiPort = 3211;
const webPort = 3198;

export default defineConfig({
  testDir: "./e2e",
  testMatch: "chat-read.spec.ts",
  fullyParallel: false,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: `http://127.0.0.1:${webPort}`,
    ...devices["Desktop Chrome"],
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: [
        "docker compose -f ../api/docker-compose.dev.yml -p \"$COMPOSE_PROJECT_NAME\" up -d --wait postgres redis",
        "docker compose -f ../api/docker-compose.dev.yml -p \"$COMPOSE_PROJECT_NAME\" exec -T postgres createdb -U postgres \"$WORKSPACEX_DB\"",
        "pnpm --filter @repo/api migrate",
        "pnpm --filter @repo/api exec tsx scripts/seed-chat-read-e2e.ts",
        "pnpm --filter @repo/api start",
      ].join(" && "),
      url: `http://127.0.0.1:${apiPort}/healthz`,
      timeout: 120_000,
      reuseExistingServer: false,
      env: {
        ...process.env,
        PORT: String(apiPort),
        CHAT_E2E_FIXTURE: "1",
        CHAT_E2E_PASSWORD: CHAT_READ_E2E.password,
        CHAT_E2E_EMAIL: CHAT_READ_E2E.email,
        CHAT_E2E_ORG_ID: CHAT_READ_E2E.orgId,
        CHAT_E2E_USER_ID: CHAT_READ_E2E.userId,
        CHAT_E2E_PROJECT_ID: CHAT_READ_E2E.projectId,
        CHAT_E2E_THREAD_ID: CHAT_READ_E2E.threadId,
        CHAT_E2E_AGENT_ID: CHAT_READ_E2E.agentId,
        CHAT_E2E_CATALOG_ONLY_AGENT_ID: CHAT_READ_E2E.catalogOnlyAgentId,
        // The catalog schema override is intentionally test-only; production always resolves
        // the public Agent catalog. Authentication in this journey still uses a signed login.
        KERNEL_ALLOW_TEST_PRINCIPAL: "1",
        KERNEL_AGENT_CATALOG_SCHEMA: "chat_wave2_fixture",
      },
    },
    {
      command: `NEXT_PUBLIC_API_URL=http://127.0.0.1:${webPort} CHAT_READ_E2E_API_ORIGIN=http://127.0.0.1:${apiPort} NEXT_DIST_DIR=.next-chat-read-e2e next dev -p ${webPort}`,
      url: `http://127.0.0.1:${webPort}/login`,
      timeout: 120_000,
      reuseExistingServer: false,
    },
  ],
});
