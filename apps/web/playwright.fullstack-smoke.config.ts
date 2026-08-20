import path from "node:path";
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
/**
 * #1415 —— `apps/deep-agent-service` 的确定性替身端口，同一套单射逻辑再往后挪一段
 * （`+15000`，落在 60000–65000，不撞 pg/redis/minio/api/web/model-provider/asr-provider
 * 任何一段）。`skill-agent-import-usecase-audit.spec.ts` 的自助发布 agent 走的是
 * `resolveDeepAgentModel()`（`DEEP_AGENT_PROVIDER_NAME`），不是主 chat provider——
 * 不配 `KERNEL_DEEP_AGENT_BASE_URL`，试跑会以 `MODEL_PROVIDER_NOT_CONFIGURED` 诚实
 * 失败（同 `playwright.chat-read.config.ts` 已经踩过、已经修好的同一件事，P6/P7）。
 */
const deepAgentProviderPort = String(Number(webPort) + 15_000);
/**
 * F962（#1608 根因排查 2026-08-20）—— 试跑沙箱替身的端口。
 *
 * ⚠ 2026-08-20 复核时发现前一版在这里写的是 `+20_000`（"落在 65000–70000"）——
 *   算错了：`webPort` 落在 45000–49999（`.harness/scripts/lib/test-isolation.ts` 的
 *   `PORT_BASE.WORKSPACEX_WEB_PORT = 45_000`，段宽 5000），`+20_000` 因此落在
 *   65000–69999，**其中 65536 往上根本不是合法 TCP 端口**（`node:net`/WHATWG `URL`
 *   都会在端口号 > 65535 时直接拒绝——本地复现：`new URL("http://127.0.0.1:65697/…")`
 *   逐字抛 `TypeError: Invalid URL`，配置文件 `require` 阶段就整体炸掉，
 *   `seeded-github-import` project 一次也没跑到测试代码，报的还是一个和这条用例
 *   毫不相关的 `TypeError: Invalid URL`）。这不是"这一段落在了别的服务头上"的邻位
 *   冲突，是**整个加法方案在 webPort 落在 45536 及以上时必然产出非法端口**——
 *   而 hash 落在这段的概率不是零，说明这条路子从写下来那一刻就是错的，不是运气问题。
 *
 *   改成往下挪一段（`-35_000`，落在 10000–14999）：pg/redis/minio/api/web 五个真实
 *   端口的段（20000/25000/30000/35000/40000/45000）全部在 20000 以上，model-provider/
 *   asr-provider/deep-agent-provider 的 `+5000/+10000/+15000` 落在 50000–64999，
 *   10000–14999 不撞其中任何一段，且远低于 65535 上限，不会重蹈同一个错。
 */
const skillSandboxPort = String(Number(webPort) - 35_000);
const apiOrigin = process.env.FULLSTACK_E2E_MODE === "wrong-api-origin"
  ? "http://127.0.0.1:1"
  : `http://127.0.0.1:${apiPort}`;
const apiPgPort = process.env.FULLSTACK_E2E_MODE === "database-unavailable" ? "1" : required("PGPORT");
const breakController = process.env.FULLSTACK_E2E_MODE === "broken-controller-route" ? "artifacts" : "";
const compose = `docker compose -f ../api/docker-compose.dev.yml -p "${required("COMPOSE_PROJECT_NAME")}"`;
/**
 * API 与 web 两格的启动窗口。**默认一字未改（120s）**，只是可以被覆盖。
 *
 * 两格都会在一台**忙碌或断网**的开发机上超过 120s，而两次失败长得一模一样
 * （`Timed out waiting 120000ms from config.webServer`，不说是哪一格），
 * 于是都会被读成「服务起不来」而不是「这台机器慢」：
 *   · web  —— 命令是 `next build && next start`，`next/font/google` 在没有外网时
 *     对每个字体分片重试三次才放弃（构建照样成功，只是慢）。实测冷构建 3m24s。
 *   · api  —— 命令以 `docker compose up -d --wait` 打头，机器上并存几十个隔离栈时
 *     healthcheck 迟迟不转绿。实测本机同时有 38 个容器，这一格拿不到 120s 内的启动。
 *
 * CI 有外网、栈是干净的，两格都落在 120s 内，所以**默认值不动**：
 * 为一台慢机器放宽全队的门控，等于把一条会红的信号调成不会红。
 * 要在慢机器上跑就显式覆盖它。
 *
 * ⚠ `database-unavailable` 那条反证**不受它影响**：那一格要的就是「快速失败」，
 *   给它一个长窗口只会让反证等满。见下方 API 那格的三元。
 */
const serverStartTimeoutMs = Number(process.env.FULLSTACK_E2E_SERVER_TIMEOUT_MS ?? 120_000);
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
  // PJ-01 / #976：真的持组织角色 `lead` 的那位（新建项目唯一有权的角色；admin 不行，U-4）。
  // ⚠ 这三行属 **`fixtureEnv`**（下发给 seed 脚本与 API 进程），合错对象 tsc 不报错但种子读不到。
  FULLSTACK_E2E_LEAD_EMAIL: FULLSTACK_E2E.leadEmail,
  FULLSTACK_E2E_LEAD_PASSWORD: FULLSTACK_E2E.leadPassword,
  FULLSTACK_E2E_LEAD_USER_ID: FULLSTACK_E2E.leadUserId,
  // #552：真的持 `security-reviewer` 职能的那位（两职能不合并，I-5/V14）。
  // ⚠ 这三行属于 **`fixtureEnv`**（下发给 seed 脚本与 API 进程），不是 `modelProviderEnv`
  //   之类别的对象 —— 合错对象时 tsc **不报错**，但 seed 读不到，表现成「种子没生效」。
  FULLSTACK_E2E_SECURITY_REVIEWER_EMAIL: FULLSTACK_E2E.securityReviewerEmail,
  FULLSTACK_E2E_SECURITY_REVIEWER_PASSWORD: FULLSTACK_E2E.securityReviewerPassword,
  FULLSTACK_E2E_SECURITY_REVIEWER_USER_ID: FULLSTACK_E2E.securityReviewerUserId,
  // F192（#598）之后：`skill-review-gate.spec.ts` 的两条 team-only 草稿改由种子建
  // （原来走「完全新建」面板现场建，那条入口已被 F192 冻结）——理由见 fixture 里
  // `reviewedSkillName` 上方的说明。只种到「草稿」，扫描/提交/批准仍是用例现场的事。
  FULLSTACK_E2E_REVIEWED_SKILL_NAME: FULLSTACK_E2E.reviewedSkillName,
  FULLSTACK_E2E_DRAFT_ONLY_SKILL_NAME: FULLSTACK_E2E.draftOnlySkillName,
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
  /**
   * #548 —— 与上面几条不同：这条**不是**为了让某个用例跑通，而是 API 进程**根本起不来**。
   *
   * `MODEL_CREDENTIAL_KEY` 缺失时 `credentialCipherFromEnv()` 抛错，`NestFactory.create`
   * 整个失败 —— 实测症状就是本 job 的
   * `[WebServer] Error: missing env var MODEL_CREDENTIAL_KEY` +
   * `Process from config.webServer was not able to start`，一条用例都没跑到。
   * 缺 key 是启动失败而不是静默降级，这是 `aes-credential-cipher.ts` 文件头写死的取舍；
   * 因此**每一个起 API 进程的地方**都得供一个，本文件是其中之一。
   */
  MODEL_CREDENTIAL_KEY: "fullstack-smoke-credential-key-not-a-secret",
  /**
   * `skill-agent-import-usecase-audit.spec.ts` ③ —— 模型 A skill 试跑要一个 modelId
   * （skill 本身没有 `model_provider`/`model_id` 列，见 `trial-run-skill.ts` 头注）。
   * 复用同一个 loopback provider/modelId：不给它配 ⇒ `MODEL_UNAVAILABLE`，
   * 那条用例会诚实地红在"没配置"而不是"接线错了"，两种红不该混在一起排查。
   */
  KERNEL_SKILL_TRIALRUN_MODEL_ID: FULLSTACK_E2E.agentModelId,
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
    // #633（人类裁决 2026-08-06）：`core-loop.spec.ts` 是唯一接入发布门（backend-gates.yml
    // `deploy` 前置条件）的 spec —— 5 分钟合并→上线 SLA 不允许再等另外 5 个 spec 跑完，
    // #631 也报过「核心闭环步骤 1 被无关 spec 的抖动拖累」。因此它必须是**独立 project**，
    // 不与下面 `seeded` 混在同一个 project 里跑（同一 project 内的文件共享调度顺序，
    // 相当于隐式耦合）。核心闭环三个 project（本项 + reset + empty-db）与 `seeded`
    // **互不 dependencies**：
    //   · backend-gates.yml 的 `verify:core-loop` 只跑 `--project=core-loop-empty-db`，
    //     Playwright 沿 dependencies 反解只会拉起 core-loop-seeded → core-loop-reset →
    //     core-loop-empty-db 三个，`seeded` 完全不参与，这是速度的来源。
    //   · harness-verify.yml 的 `verify:fullstack-smoke` 跑 `--project=seeded-github-import`
    //     （沿 dependencies 反解先跑 `seeded` 再跑它自己，见下方 `seeded-github-import`
    //     project 头注），信息性、不阻塞合并（人类裁决：module verify 继续阻塞，
    //     浏览器 e2e 不再阻塞合并）。
    // ⚠ 代价：两条 project 链不再共享「reset 前所有种子态 spec 必须先跑完」这条保证
    //   （旧版靠 core-loop-reset dependencies: ["seeded"] 保证）。这个保证只有在**同一次
    //   Playwright 调用里两条链都被选中**时才有意义——而现在两条链在 CI 里从来不会同时
    //   被同一次调用选中（各自 `with-test-isolation` 独立起栈），本地如果手动不带
    //   `--project` 跑全量，两条链间的相对顺序不再保证，可能出现「seeded 那 5 个 spec
    //   跑在被 core-loop-reset 清过的库上」——如果需要本地全量回归，请用
    //   `pnpm run verify:full`，它会依次、各自独立地跑 `seeded` 与 `core-loop`
    //   （两次独立 with-test-isolation 起栈，见 package.json），不会互相踩。
    {
      name: "seeded",
      testMatch: [
        "fullstack-smoke.spec.ts",
        "capability-mutate-smoke.spec.ts",
        "canvas-template-create-smoke.spec.ts",
        // ⚠ #520 与 #496 同理，必须排在 `seeded` 里：它要用种子里的组织管理员登录。
        "skill-create-smoke.spec.ts",
        // ⚠ #552 同理排在 `seeded`：它要用种子里的三个账号（提交人 / 第二评审人 /
        //   安全评审人）以及 `skill_reviewer_functions` 里的职能指派。
        "skill-review-gate.spec.ts",
        // ⚠ PJ-01 / #976 同理排在 `seeded`：它要用种子里的 `lead`（新建项目唯一有权的角色）
        //   与 consultant（反证：非 lead 必须被服务端拒绝）两个账号。
        "project-create-smoke.spec.ts",
        // ⚠ #853 同理排在 `seeded`：它要用种子里的 sentinel 工作坊（`FULLSTACK_E2E.projectId`）
        //   与该工作坊的 facilitator（`FULLSTACK_E2E.email`，agendaSegment.create 只属这个角色）。
        "agenda-segment-create-smoke.spec.ts",
        // ⚠ 蓝本管理闭环 + 契约缺口审计（2026-08-15 由 blueprint-to-project-journey.spec.ts
        //   重命名，见 issue #1323——旧名暗示测试走到了「建项目」，实际没有，见文件头注）
        //   同理排在 `seeded`：它要用种子里的组织管理员（`FULLSTACK_E2E.adminEmail`，
        //   唯一能写蓝本的角色）与 sentinel 项目（`FULLSTACK_E2E.projectId`，F29
        //   缺口门控那条用它做 404 归因排除）。
        "blueprint-contract-gap-audit.spec.ts",
        // ⚠ F208 同理排在 `seeded`：它同样要用种子里的组织管理员（唯一能写蓝本的角色）。
        //   它与上面那条互补——上面测的是蓝本管理闭环与契约缺口，这条专测
        //   「16 项配置全部是结构化面板」在真栈里成立（人类 2026-08-18 批评的正是
        //   「每个配置菜单都是一个 textbox」，组件测试是对着 mock 断的，这条对着真栈断）。
        "blueprint-designer-16-panels.spec.ts",
        // ⚠ F961 同理排在 `seeded`：它要用种子里的 sentinel 工作坊
        //   （`FULLSTACK_E2E.projectId`）与该工作坊的 facilitator——分组编排
        //   （`updateGrouping`）只属这个角色，而访谈对象表嵌在组卡内，没有组就无处可填。
        //   它会往 sentinel 工作坊里真实建一个分组：全仓 `grep project-prep-groups`
        //   确认没有任何别的 spec 断言「分组为空」，不会像 #520/#496 那样把别人写脏。
        "interview-subjects-smoke.spec.ts",
        // ⚠ P2（#1561）图像通道诚实降级：同理排在 `seeded`——它要用种子里可运行的
        //   agent（`FULLSTACK_E2E.agentId`）与确定性上游 `loopback-model-provider.ts`
        //   （回显真实收到的 userText，是本用例证明"图像通道真的组装进 ModelCallInput"
        //   的关键取证点）。
        "chat-vision-honest-degrade.spec.ts",
        // ⚠ F48/F49 同理排在 `seeded`：它要用种子里三个角色（引导师 `email` 挂 skill/
        //   发消息、非管理员 `memberEmail` 做 D3 反证、`adminEmail` 处置）与现成的
        //   可挂载 skill / 可运行 agent——同 `chat-vision-honest-degrade.spec.ts` 的理由，
        //   复用现成夹具，不重新发明 chat 链路。
        "feedback-loop-smoke.spec.ts",
      ],
      grepInvert: EMPTY_DB_TAG_RE,
    },
    {
      /**
       * 「agent/skill 从 GitHub 导入 → 文件浏览+编辑 → 后台测试 → chat `#` 调用」
       * 这条用户旅程的验收线**不能**并进上面的 `seeded`（尽管它同样要用种子里的组织
       * 管理员与 sentinel 项目）——它的用例①会真的往 skill 目录里落一行 GitHub 导入的
       * skill，而 `skill-create-smoke.spec.ts`（在 `seeded` 里）断言的是**目录从空态
       * 起步**（`skill-catalog-empty`，验证种子不预置示例 skill）。
       *
       * Playwright 不按 `testMatch` 数组声明的顺序跑文件，而是按发现到的文件名
       * **字典序**（`playwright test --list` 实测可证）：`skill-agent-import-...`
       * 排在 `skill-create-smoke` 之前，于是用例①的导入会先跑，把目录写脏，
       * `skill-create-smoke.spec.ts:81` 的空态断言随之打红——这不是两条用例谁的
       * 断言错了，是**同一个 project 内的隐式字典序**这件事本身靠不住（今天靠字母
       * 巧合躲过，明天随便一个新文件名就能把顺序打乱）。
       *
       * 用 `dependencies` 把它拆成单独 project、显式排在 `seeded` **之后**，
       * 而不是给用例①加"导入后自清理"：skill 契约目前没有任何删除路径能把一个
       * 真实导入的 skill 从目录里摘掉（`hardDeleteSkill` 契约里 `out: z.never()`，
       * 明写着"没有成功形状"，恒被拒绝，见 `packages/contracts/src/skills.ts` 头注
       * `KNOWN_CONTRACT_GAPS.S1`）——伪造一条清理路径反而会在验收线里悄悄验证一个
       * 不存在的能力。两条用例的断言力度都不削弱：`skill-create-smoke` 的空态
       * 断言继续对着一个真空目录跑，`skill-agent-import-usecase-audit` 的导入
       * 断言继续对着真实 GitHub 内容跑，只是执行顺序从"字典序巧合"变成
       * "Playwright dependency graph 显式保证"。
       */
      name: "seeded-github-import",
      testMatch: ["skill-agent-import-usecase-audit.spec.ts"],
      grepInvert: EMPTY_DB_TAG_RE,
      dependencies: ["seeded"],
    },
    {
      /**
       * F965 —— 「成果沉淀」tab 真栈截图取证（`project-results-shots.spec.ts`），
       * 供 rev-uiux 对齐 `ui-preview/project-v2/uc-00-3-results-*.png` 十张基准图。
       *
       * ⚠ **不是规格，是取证工具**（零 expect，只截图），同 `chat-main-shots.spec.ts`
       *   的理由：没有断言的 spec 接进被 CI 门控自动选中的 project 只会一直绿，
       *   等于加一条不会红的耗时步骤。因此**独立成一个具名 project**、不放进
       *   `seeded` 自己的 `testMatch` 数组——`harness-verify.yml` 的
       *   `verify:fullstack-smoke` 只显式点 `--project=seeded-github-import`
       *   （沿 `dependencies` 反解拉起 `seeded`），不会拉起这个 project，
       *   本 project 只由 `pnpm run shots:project-results` 显式点名调用。
       * ⚠ `dependencies: ["seeded"]` 复用同一次 `seeded` 起栈与种子（同
       *   `seeded-github-import`），不是第二份栈定义——种子里没有为这个项目预置
       *   `backflow`/`provenance` 数据，拍到的「成果去向/审计与反馈」两节是真实空态，
       *   已在 spec 文件头注里如实标注。
       */
      name: "project-results-shots",
      testMatch: ["project-results-shots.spec.ts"],
      grepInvert: EMPTY_DB_TAG_RE,
      dependencies: ["seeded"],
    },
    {
      name: "core-loop-seeded",
      testMatch: ["core-loop.spec.ts"],
      grepInvert: EMPTY_DB_TAG_RE,
    },
    {
      name: "core-loop-reset",
      testMatch: ["core-loop-reset.setup.ts"],
      // #633：改依赖 core-loop-seeded（不再是 seeded）—— 见上面 project 数组头部注释。
      dependencies: ["core-loop-seeded"],
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
    /**
     * #1415 —— `apps/deep-agent-service` 的确定性替身，逐字抄
     * `playwright.chat-read.config.ts` 的同一段（`scripts/loopback-deep-agent-provider.ts`
     * 自己的头注：不是起真的 Python/LangGraph 服务，是在真实 `DeepAgentModelProvider`
     * 代码路径上换一个可预测的 HTTP 上游）。
     */
    {
      command: "pnpm --filter @repo/api exec tsx scripts/loopback-deep-agent-provider.ts",
      url: `http://127.0.0.1:${deepAgentProviderPort}/healthz`,
      timeout: 30_000,
      reuseExistingServer: false,
      env: {
        ...process.env,
        LOOPBACK_DEEP_AGENT_PROVIDER_PORT: deepAgentProviderPort,
      },
    },
    {
      command: "pnpm --filter @repo/api exec tsx scripts/loopback-skill-sandbox.ts",
      url: `http://127.0.0.1:${skillSandboxPort}/healthz`,
      timeout: 30_000,
      reuseExistingServer: false,
      env: {
        ...process.env,
        LOOPBACK_SKILL_SANDBOX_PORT: skillSandboxPort,
      },
    },
    {
      command: [
        `${compose} up -d --wait postgres redis minio`,
        "pnpm --filter @repo/api exec tsx scripts/seed-fullstack-smoke.ts",
        `PGPORT=${apiPgPort} pnpm --filter @repo/api start`,
      ].join(" && "),
      url: `http://127.0.0.1:${apiPort}/healthz`,
      // ⚠ `database-unavailable` 反证要的就是**快速失败**，给它长窗口只会让反证等满。
      timeout:
        process.env.FULLSTACK_E2E_MODE === "database-unavailable" ? 20_000 : serverStartTimeoutMs,
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
        // #1415 —— 不供这一条，`DeepAgentModelProvider` 会以 `MODEL_PROVIDER_NOT_CONFIGURED`
        // 诚实失败（该 provider 自己的 config 头注），自助发布的 agent 试跑会打不通。
        // 逐字同一条纪律见 `playwright.chat-read.config.ts` 的同一变量。
        KERNEL_DEEP_AGENT_BASE_URL: `http://127.0.0.1:${deepAgentProviderPort}`,
        // F962（#1608）—— 不供这一条，`HttpSkillSandbox` 在调用时诚实抛
        // `SANDBOX_UNAVAILABLE`，试跑执行链在「生成脚本」之后的沙箱这一步打不通。
        // 逐字同一条纪律见上面 `KERNEL_DEEP_AGENT_BASE_URL` 那条注释。
        KERNEL_SKILL_SANDBOX_BASE_URL: `http://127.0.0.1:${skillSandboxPort}`,
        PORT: apiPort,
      },
    },
    {
      command: `next build && next start -p ${webPort}`,
      url: `http://127.0.0.1:${webPort}/login`,
      // 默认仍是 120s；只有显式设了 `FULLSTACK_E2E_SERVER_TIMEOUT_MS` 才不同。见上方定义。
      timeout: serverStartTimeoutMs,
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
        /**
         * #951 —— 让 `next build` 的 `next/font/google` 完全不联网（hermetic）。
         *
         * 不配它会怎样：build 期间 next 真去 fonts.googleapis.com 拉 CSS + 逐片下载字体，
         * Google 边缘节点偶发返回不带扩展名的字体 URL 时，loader.js:112 对 null 取 `[1]`
         * 崩掉整个 build，CI 表现为
         * `[WebServer] TypeError: Cannot read properties of null (reading '1')` +
         * `Process from config.webServer was not able to start`（2026-08-11 一天三红）。
         *
         * 这不是 mock 掉被测物：字体是纯视觉资源，smoke 断言全走 data-testid 与文本；
         * 与本文件里 loopback model/ASR 上游是同一条哲学——外部非确定性上游一律换成
         * 我们能预测输出的本地事实。键与 layout.tsx 失配时 build 会以
         * `Missing mocked response for URL: ...` 确定性变红，指向 mock 文件自己。
         */
        NEXT_FONT_GOOGLE_MOCKED_RESPONSES: path.resolve(
          __dirname,
          "e2e/support/google-fonts-mock.cjs",
        ),
      },
    },
  ],
});
