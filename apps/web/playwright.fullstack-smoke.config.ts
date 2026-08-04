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
  FULLSTACK_E2E_ADMIN_EMAIL: FULLSTACK_E2E.adminEmail,
  FULLSTACK_E2E_ADMIN_PASSWORD: FULLSTACK_E2E.adminPassword,
  FULLSTACK_E2E_ADMIN_USER_ID: FULLSTACK_E2E.adminUserId,
  FULLSTACK_E2E_MEMBER_EMAIL: FULLSTACK_E2E.memberEmail,
  FULLSTACK_E2E_MEMBER_PASSWORD: FULLSTACK_E2E.memberPassword,
  FULLSTACK_E2E_MEMBER_USER_ID: FULLSTACK_E2E.memberUserId,
};

export default defineConfig({
  testDir: "./e2e",
  // #458 的写路径门控单独成文件（原因见该文件头），与 #387 共用同一套 webServer 与同一个库。
  // #492 的 `core-loop.spec.ts` 是核心闭环八步的验收规格**兼进度板**：未实现的步骤用
  // `test.fail()` 显式红着，不许 skip —— skip 会制造「闭环已通」的错觉。
  // 它复用这套 webServer 与同一个库，**不新建 config / docker 栈 / CI job**（单 runner 是硬瓶颈）。
  // ⚠ 已知限制见该 spec 文件头：这套 webServer 的启动命令里写死了 seed，
  //   因此它拿不到未种子化的空库，步骤 1「注册**第一个**用户」被如实标成基础设施阻塞。
  testMatch: ["fullstack-smoke.spec.ts", "capability-mutate-smoke.spec.ts", "core-loop.spec.ts"],
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
      command: `next build && next start -p ${webPort}`,
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
