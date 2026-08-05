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
/**
 * #435 —— 确定性模型提供方的端口。
 *
 * ⚠ 不改 `.harness/scripts/lib/test-isolation.ts` 去多分配一个端口：那是**所有** worker
 *   共用的隔离事实源，为一条用例动它，代价落在整支队伍身上。
 *
 * `webPort` 由隔离哈希落在 45000–50000 这一段且**每个隔离唯一**，因此 `+5000` 是一个
 * 单射，落在 50000–55000 这一段无人认领的区间里 —— 不同隔离之间不会撞，
 * 也不会撞上 pg/redis/minio/api/web 任何一段。
 */
const modelProviderPort = String(Number(webPort) + 5_000);
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
  // #435：种一个**真的跑得起来**的 Agent。provider/model 只有这一份字面量（见 fixture）。
  FULLSTACK_E2E_AGENT_ID: FULLSTACK_E2E.agentId,
  FULLSTACK_E2E_AGENT_NAME: FULLSTACK_E2E.agentDisplayName,
  FULLSTACK_E2E_AGENT_MODEL_PROVIDER: FULLSTACK_E2E.agentModelProvider,
  FULLSTACK_E2E_AGENT_MODEL_ID: FULLSTACK_E2E.agentModelId,
};

/**
 * #435 —— 显式选中的确定性模型提供方。**这不是 mock fallback。**
 *
 * `ConfiguredModelProvider` 只认 `KERNEL_MODEL_PROVIDER` 这一个名字，并且拒绝任何与 run
 * 快照里 `model_provider` 不同的值（`configured-model-provider.ts:60-73`）——那里没有
 * list、没有 map、没有 "default"，所以**不存在**「悄悄退回到它」的路径。被测的仍然是
 * 真实适配器走真实 HTTP，只是上游是一个我们能预测其输出的进程；这与
 * `apps/api/tests/agent-runtime/no-tool-run-writeback.test.ts:108-137` 是同一套做法。
 *
 * 不配它会怎样：run 以 `MODEL_PROVIDER_NOT_CONFIGURED` **诚实地失败**，
 * 界面上 `chat-live-agent-run-status` 显示 failed，绝不会冒出一条编造的回复。
 */
const modelProviderEnv = {
  KERNEL_MODEL_PROVIDER: FULLSTACK_E2E.agentModelProvider,
  KERNEL_MODEL_BASE_URL: `http://127.0.0.1:${modelProviderPort}`,
  // 仅供本地回环进程校验存在性；`ConfiguredModelProvider` 要求 apiKey 非空才认为「已配置」。
  KERNEL_MODEL_API_KEY: "fullstack-smoke-loopback-key-not-a-secret",
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
    // #435：模型提供方排在 API 之前 —— API 启动时就把 provider 配置读死了
    // （`readModelProviderConfig` 在组装期读一次，见 `configured-model-provider.ts:38-49`），
    // 但真正的连接发生在 run 执行时，所以顺序上只要它先 ready 即可。
    {
      command: "pnpm --filter @repo/api exec tsx scripts/loopback-model-provider.ts",
      url: `http://127.0.0.1:${modelProviderPort}/healthz`,
      timeout: 30_000,
      reuseExistingServer: false,
      env: {
        ...process.env,
        LOOPBACK_MODEL_PROVIDER_PORT: modelProviderPort,
        LOOPBACK_MODEL_REPLY_PREFIX: FULLSTACK_E2E.agentReplyPrefix,
      },
    },
    {
      command: [
        `${compose} up -d --wait postgres redis minio`,
        "pnpm --filter @repo/api exec tsx scripts/seed-fullstack-smoke.ts",
        `PGPORT=${apiPgPort} pnpm --filter @repo/api start`,
      ].join(" && "),
      url: `http://127.0.0.1:${apiPort}/healthz`,
      timeout: process.env.FULLSTACK_E2E_MODE === "database-unavailable" ? 20_000 : 120_000,
      reuseExistingServer: false,
      env: { ...process.env, ...fixtureEnv, ...modelProviderEnv, PORT: apiPort },
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
