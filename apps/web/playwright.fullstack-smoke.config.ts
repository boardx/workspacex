import { defineConfig, devices } from "@playwright/test";
import { EMPTY_DB_TAG_RE } from "./e2e/core-loop-fixture";
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
  //
  // ⚠ 三个 project，一套 webServer，一个 docker 栈，一个 CI job。
  //   `webServer` 是 **config 级**的，它的启动命令里写死了 `seed-fullstack-smoke.ts`；
  //   而 #492 步骤 1 要验「注册**第一个**用户」，需要一个**零用户**的库。
  //   project 级能各自带 setup 与依赖，所以顺序由 `dependencies` 排，而不是另开一个 config：
  //
  //       seeded  ──▶  core-loop-reset  ──▶  core-loop-empty-db
  //     （吃种子的全部 spec）   （清库）        （只有 @empty-db 那一条）
  //
  //   清库在所有吃种子的 spec 之后才发生，因此 #387 / #458 / 步骤 2·5·6a 不受影响。
  //   反证复现：`CORE_LOOP_COUNTERPROOF=1 pnpm run verify:fullstack-smoke`（步骤 1 必红）。
  //
  // ⚠ #496 的 `canvas-template-create-smoke.spec.ts` 必须排在 **`seeded`** 里：它要用
  //   种子里的组织管理员登录。排进 `core-loop-empty-db` 会跑在 `core-loop-reset` 清过的
  //   库上，那时连账号都没有 —— 它会红，但**不是因为对的原因**。
  projects: [
    {
      name: "seeded",
      testMatch: [
        "fullstack-smoke.spec.ts",
        "capability-mutate-smoke.spec.ts",
        "canvas-template-create-smoke.spec.ts",
        "core-loop.spec.ts",
        // ⚠ #520 与 #496 同理，必须排在 `seeded` 里：它要用种子里的组织管理员登录。
        //   排进 `core-loop-empty-db` 会跑在清过的库上，那时连账号都没有——它会红，
        //   但**不是因为对的原因**。
        "skill-create-smoke.spec.ts",
      ],
      grepInvert: EMPTY_DB_TAG_RE,
    },
    {
      name: "core-loop-reset",
      testMatch: ["core-loop-reset.setup.ts"],
      dependencies: ["seeded"],
    },
    {
      name: "core-loop-empty-db",
      testMatch: ["core-loop.spec.ts"],
      grep: EMPTY_DB_TAG_RE,
      dependencies: ["core-loop-reset"],
    },
  ],
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
