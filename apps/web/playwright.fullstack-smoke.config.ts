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
/**
 * #466 —— 确定性 ASR 上游的端口。
 *
 * 与上面的 `+5000` 同一条推理：`webPort` 落在 45000–50000 且每个隔离唯一，
 * `+10000` 也是一个单射，落在 55000–60000 这段无人认领的区间里 ——
 * 不同隔离之间不会撞，也不会撞上 pg/redis/minio/api/web/model-provider 任何一段。
 * 同样**不去动** `.harness/scripts/lib/test-isolation.ts`：那是全队共用的隔离事实源。
 */
const asrProviderPort = String(Number(webPort) + 10_000);
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
  // #552：真的持 `security-reviewer` 职能的那位（两职能不合并，I-5/V14）。
  // ⚠ 这三行属于 **`fixtureEnv`**（下发给 seed 脚本与 API 进程），不是 `modelProviderEnv`
  //   之类别的对象 —— 合错对象时 tsc **不报错**，但 seed 读不到，表现成「种子没生效」。
  FULLSTACK_E2E_SECURITY_REVIEWER_EMAIL: FULLSTACK_E2E.securityReviewerEmail,
  FULLSTACK_E2E_SECURITY_REVIEWER_PASSWORD: FULLSTACK_E2E.securityReviewerPassword,
  FULLSTACK_E2E_SECURITY_REVIEWER_USER_ID: FULLSTACK_E2E.securityReviewerUserId,
  // #435：种一个**真的跑得起来**的 Agent。provider/model 只有这一份字面量（见 fixture）。
  FULLSTACK_E2E_AGENT_ID: FULLSTACK_E2E.agentId,
  FULLSTACK_E2E_AGENT_NAME: FULLSTACK_E2E.agentDisplayName,
  FULLSTACK_E2E_AGENT_MODEL_PROVIDER: FULLSTACK_E2E.agentModelProvider,
  FULLSTACK_E2E_AGENT_MODEL_ID: FULLSTACK_E2E.agentModelId,
  // #467：第 8a 步要挂的那个 skill。必须是「已启用」——理由见 fixture 里的说明。
  FULLSTACK_E2E_MOUNTABLE_SKILL_ID: FULLSTACK_E2E.mountableSkillId,
  FULLSTACK_E2E_MOUNTABLE_SKILL_NAME: FULLSTACK_E2E.mountableSkillName,
  // #466：第 7 步录音用的线程 + 它的授权矩阵（为什么必须预置见 fixture）。
  FULLSTACK_E2E_RECORDING_THREAD_ID: FULLSTACK_E2E.recordingThreadId,
  FULLSTACK_E2E_RECORDING_THREAD_TITLE: FULLSTACK_E2E.recordingThreadTitle,
  // #493：第 8c 步要**用**的那个模板（必须 published）与它的落点议程环节（必须 active）。
  // 两者都只是前置条件，绑定行一条都不种——理由见 fixture 里的说明。
  FULLSTACK_E2E_BOUND_TEMPLATE_KEY: FULLSTACK_E2E.boundTemplateKey,
  FULLSTACK_E2E_BOUND_TEMPLATE_NAME: FULLSTACK_E2E.boundTemplateName,
  FULLSTACK_E2E_AGENDA_SEGMENT_ID: FULLSTACK_E2E.agendaSegmentId,
  FULLSTACK_E2E_AGENDA_SEGMENT_TITLE: FULLSTACK_E2E.agendaSegmentTitle,
};

/**
 * #466 —— 显式选中的确定性 ASR 上游。**这不是 mock fallback**，理由与
 * `modelProviderEnv` 逐条同型（见 `configured-realtime-asr-provider.ts` 文件头）：
 * `ConfiguredRealtimeAsrProvider` 只认这一组变量，没有 list、没有 map、没有 default。
 *
 * 不配它会怎样：WS 面以 `ASR_NOT_CONFIGURED` **诚实地失败**，界面上
 * `chat-live-recording-error` 显示「本组织尚未配置转写服务」，
 * 绝不会冒出一段编造的转录。
 *
 * ⚠ `KERNEL_ASR_MODEL` 是一个**配置值**，不是源码里的字面量 ——
 *   contract.md §3 与 `no-hardcoded-model-list.test.ts` 都要求模型名不进源码。
 */
const asrProviderEnv = {
  KERNEL_ASR_PROVIDER: "fullstack-loopback-asr",
  KERNEL_ASR_BASE_URL: `ws://127.0.0.1:${asrProviderPort}`,
  KERNEL_ASR_API_KEY: "fullstack-smoke-loopback-asr-key-not-a-secret",
  KERNEL_ASR_MODEL: "loopback-transcribe",
  // 收尾等待：本地回环是毫秒级的，15 秒的生产默认值只会让失败等满 15 秒。
  KERNEL_ASR_FINISH_GRACE_MS: "5000",
  /**
   * `EnvTranscriptionPolicyProvider` 没配阈值就**拒绝入库**（设计如此，D-1 未裁决，
   * 该 bundle 不许自己挑一个数）。实测：不配它，第 7 步红在
   * `ingest failed: RECORDING_LOW_CONFIDENCE_THRESHOLD is not set` —— 门是活的。
   *
   * ⚠ 变量名取自 `env-transcription-policy.ts` 的 `LOW_CONFIDENCE_THRESHOLD_ENV`，
   *   不是猜的。第一版按 `KERNEL_` 前缀猜了一个，整条链路跑通但落库被拒。
   *
   * 回环上游回 0.97，阈值 0.5 ⇒ 判定为**不低置信度**。这让 `lowConfidence`
   * 有一个真实判据，而不是恒 false。
   */
  RECORDING_LOW_CONFIDENCE_THRESHOLD: "0.5",
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
        // ⚠ #552 同理排在 `seeded`：它要用种子里的三个账号（提交人 / 第二评审人 /
        //   安全评审人）以及 `skill_reviewer_functions` 里的职能指派。排进
        //   `core-loop-empty-db` 会跑在清过的库上，那时连账号都没有。
        "skill-review-gate.spec.ts",
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
    /**
     * #466 —— 麦克风权限 + 假音频源。
     *
     * `--use-fake-device-for-media-stream` 给的是 Chrome 自己合成的一段音频
     * （不是静音），所以 `getUserMedia` → `AudioContext` → PCM16 这条链路上跑的是
     * **真实的浏览器采音代码**，只是设备是虚拟的。**没有**在任何地方打桩
     * `MediaRecorder` / `getUserMedia`：那样就只是在测我们自己的桩。
     *
     * `--use-fake-ui-for-media-stream` 让权限提示自动允许 —— headless 里没有人能点它。
     * `permissions: ["microphone"]` 是同一件事的 Playwright 侧表达，两个都留着：
     * 前者管提示，后者管权限状态。
     */
    permissions: ["microphone"],
    launchOptions: {
      args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
    },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: [
    // #435：模型提供方排在 API 之前 —— API 启动时就把 provider 配置读死了
    // （`readModelProviderConfig` 在组装期读一次，见 `configured-model-provider.ts:38-49`），
    // 但真正的连接发生在 run 执行时，所以顺序上只要它先 ready 即可。
    // #466：确定性 ASR 上游。与模型提供方同理，只要在 API 之前 ready 即可。
    {
      command: "pnpm --filter @repo/api exec tsx scripts/loopback-asr-provider.ts",
      url: `http://127.0.0.1:${asrProviderPort}/healthz`,
      timeout: 30_000,
      reuseExistingServer: false,
      env: {
        ...process.env,
        LOOPBACK_ASR_PROVIDER_PORT: asrProviderPort,
        LOOPBACK_ASR_TRANSCRIPT_PREFIX: FULLSTACK_E2E.asrTranscriptPrefix,
      },
    },
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
      env: {
        ...process.env, ...fixtureEnv, ...modelProviderEnv,
        // #466 反证 `no-asr-provider`：把 ASR 上游的配置整组撤掉，
        // WS 面必须以 `ASR_NOT_CONFIGURED` 诚实降级，而不是静默失败或换个提供方。
        ...(process.env.CORE_LOOP_COUNTERPROOF_7 === "no-asr-provider" ? {} : asrProviderEnv),
        // #466 反证 `drop-persist` / `noop-persist`：开关下发给 API 进程本身
        // （浏览器拦不住服务端内部的落库调用）。见 `interface/recording/segment-ingestion.ts`。
        ...(process.env.WORKSPACEX_COUNTERPROOF_INGEST
          ? { WORKSPACEX_COUNTERPROOF_INGEST: process.env.WORKSPACEX_COUNTERPROOF_INGEST }
          : {}),
        // #552 反证 B：`skip-status-persist` —— 评审照常判定、评审记录照常写、
        // HTTP 200 照常返回 `已启用`，但 `applyTransition` 一次都不调用。
        // 开关下发给 **API 进程**（浏览器拦不住服务端内部的落库调用），
        // 与上面 `WORKSPACEX_COUNTERPROOF_INGEST` 逐字同一个落法。
        // 见 `interface/controllers/skill-review.controller.ts` 的 `skipsStatusPersist`。
        ...(process.env.WORKSPACEX_COUNTERPROOF_SKILL_REVIEW
          ? { WORKSPACEX_COUNTERPROOF_SKILL_REVIEW: process.env.WORKSPACEX_COUNTERPROOF_SKILL_REVIEW }
          : {}),
        PORT: apiPort,
      },
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
        // #466：**WS 不能走 Next 的 rewrite** —— 那是 HTTP 代理，`Upgrade` 到那里就断了。
        // 所以流式面直连 API 源。这不是绕过 CORS（WS 本来就不受 CORS 约束）：
        // 能不能连由服务端握手判定，见 `apps/api/src/interface/ws/asr-stream.gateway.ts`。
        NEXT_PUBLIC_API_WS_URL: `http://127.0.0.1:${apiPort}`,
        FULLSTACK_E2E_API_ORIGIN: apiOrigin,
        FULLSTACK_E2E_BREAK_CONTROLLER: breakController,
        NEXT_DIST_DIR: ".next-fullstack-e2e",
      },
    },
  ],
});
