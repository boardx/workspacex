/**
 * 本地形态 ↔ 云端形态的**配置平价清单**（PROP-LOCAL-WORKSPACE-001 §1.3 / §6 的
 * 「必需 env 单一清单」，此前一直没有落地）。
 *
 * ## 它回答的问题
 *
 * 「API 读的这个环境变量，本地版为什么没有？」——此前这个问题没有任何地方能回答。
 * `config.ts` 只说本地**设了什么**；没设的那九十多个里，哪些是"默认值本来就对"、
 * 哪些是"云端专属"、哪些是"某个能力在本地就是关的"、哪些是"设了就会削弱本地版的承诺"，
 * 全靠读代码的人自己推。于是每加一个 `KERNEL_*`，本地版就可能多一个**没人发现的缺口**
 * ——`SKILL_STARTER_PACK_ROOT` 就是这么漏掉的：未配置时 pack source 永远返回 NOT_FOUND，
 * 本地版的 starter pack 导入面整个是 404，而没有任何东西会因此变红。
 *
 * 所以这份清单不是文档，是**门控**：`test/parity.test.ts` 扫描 `apps/api/src` 的真实
 * `env.X` 读取点，任何一个既不在 `config.ts` 供给、也不在本清单里的名字，测试当场红。
 * 新增一个环境变量的人被迫回答「本地版怎么办」，而不是默认留个洞。
 *
 * ⚠ 本文件**不复述** `config.ts` 供给的那一份：`supplied` 是算出来的，不是写下来的。
 *   同一事实不得声明在两处（AGENTS.md）。
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * 一个未供给的环境变量，在本地形态里的处置。四类，闭集。
 *
 * ⚠ 没有「不知道」这一档，是故意的。分不清属于哪一档，说明还没判断过这条对本地版的
 *   影响——那正是这份清单存在的理由。
 */
export type ParityStatus =
  /** API 内建默认值对本地形态就是对的（超时、开关默认值、回退到 `KERNEL_MODEL_ID` 的模型 id…）。 */
  | "default-ok"
  /** 只在容器/云端编排里有意义；本地没有那个部件，缺失不改变任何行为。 */
  | "cloud-only"
  /** 缺失 = 某个能力在本地**明确关闭**。必须在用户可见处如实标注，不能静默失败。 */
  | "unavailable-locally"
  /** 本地设了就会削弱本地版的安全承诺；必须保持不设。 */
  | "must-stay-unset";

export interface ParityGroup {
  readonly status: ParityStatus;
  readonly reason: string;
  readonly names: readonly string[];
}

/**
 * 未由 `config.ts` 供给的环境变量，按处置分组。
 *
 * ⚠ 顺序无意义，分组才有意义；一个名字只能出现在一组里（测试钉住）。
 */
export const LOCAL_ENV_PARITY: readonly ParityGroup[] = [
  {
    status: "default-ok",
    reason:
      "API 自带的默认值就是本地形态要的答案：超时/轮询/日志阈值，默认开着的 autostart，" +
      "以及一路回退到 KERNEL_MODEL_ID 的那些专用模型 id。显式再设一遍只会多一份会漂移的副本。",
    names: [
      "AGENT_STARTER_PACK_ROOT", // 仓库根本没有 agent starter pack 目录，云端同样未配；不是本地缺口
      "DEBUG_TRACE_ENABLED", "DEBUG_TRACE_SLOW_MS", "DEBUG_TRACE_STALL_MS",
      "KERNEL_AGENT_RUN_AUTOSTART", "KERNEL_AGENT_RUN_STALE_RUNNING_MS",
      "KERNEL_ATTACHMENT_EXTRACTION_AUTOSTART", "KERNEL_SKILL_TRIALRUN_AUTOSTART",
      "KERNEL_ASR_FINISH_GRACE_MS", "KERNEL_ASR_NEUTRAL_CONFIDENCE",
      "KERNEL_ASR_RECORDING_TURN_SILENCE_MS", "KERNEL_ASR_TURN_SILENCE_MS",
      "KERNEL_CANVAS_TEMPLATE_MODEL_ID", "KERNEL_CANVAS_TEMPLATE_MODEL_PROVIDER",
      "KERNEL_GUIDED_RESEARCH_MODEL_PROVIDER",
      "KERNEL_GUIDED_RESEARCH_MODEL_ID", "KERNEL_DIGITAL_INTERVIEW_SKILL_MODEL_ID",
      "KERNEL_ERROR_LOG_SUMMARY_MODEL_ID", "KERNEL_FEEDBACK_STRUCTURE_MODEL_ID",
      "KERNEL_FOLLOWUP_SUGGESTIONS_MODEL_ID", "KERNEL_SKILL_TRIALRUN_MODEL_ID",
      "KERNEL_THREAD_TITLE_MODEL_ID",
      "KERNEL_DEEP_AGENT_POLL_INTERVAL_MS", "KERNEL_DEEP_AGENT_TIMEOUT_MS",
      "KERNEL_DESIGN_CHAT_TIMEOUT_MS", "KERNEL_KEEP_LOGS",
      "KERNEL_MODEL_MAX_OUTPUT_TOKENS", "KERNEL_MODEL_TIMEOUT_MS",
      "KERNEL_STANDARD_SCHEDULER", // 云端同样不开（仓库里没有任何部署设它）
      "PGCONNECT_TIMEOUT_MS", "PGSTATEMENT_TIMEOUT_MS", "STANDARD_SQL_BINDINGS",
    ],
  },
  {
    status: "cloud-only",
    reason:
      "只对容器编排/托管数据服务有意义。本地没有 Redis、没有 RDS、没有 OSS、没有 unix socket 形态的沙箱，" +
      "也没有 Cloudflare/GitHub 这类外部服务账号——缺失不改变本地任何一条行为。",
    names: [
      "REDIS_HOST", "REDIS_PORT", "REDIS_USERNAME", "REDIS_PASSWORD", "REDIS_PREFIX",
      "REDIS_TLS", "REDIS_CONNECT_TIMEOUT_MS", "WORKSPACEX_DB",
      "PGSSLROOTCERT", "WORKSPACEX_RDS_TLS_EXCEPTION",
      "OSS_ACCESS_KEY_ID", "OSS_ACCESS_KEY_SECRET", "OSS_SECURITY_TOKEN",
      "WORKSPACEX_DEPLOY_PROFILE", "WORKSPACEX_DEPLOYMENT_MARKER", "DEV_APP_UPTIME_URL",
      "KERNEL_SKILL_SANDBOX_SOCKET",
      "CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_TOKEN", "CLOUDFLARE_EMAIL_API_TOKEN",
      "CLOUDFLARE_TXN_EMAIL_API_TOKEN", "CLOUDFLARE_EMAIL_SENDING_DOMAIN",
      "CLOUDFLARE_EMAIL_PREVIEW", "CLOUDFLARE_EMAIL_PREVIEW_DISABLED",
      "MAIL_FROM", "MAIL_OUTBOX_WORKER_ENABLED",
      "GITHUB_ISSUE_TOKEN", "GITHUB_ISSUE_REPO_OWNER", "GITHUB_ISSUE_REPO_NAME",
      "GITHUB_ISSUE_ATTACHMENTS_BRANCH",
    ],
  },
  {
    status: "unavailable-locally",
    reason:
      "缺失 = 这条能力在本地版明确关闭（PROP §1.3 最后一行）。这些必须在用户看得见的地方如实标注" +
      "「本地版不可用 / 连接云端后可用」，不许静默失败——判据见 capabilities.ts。",
    names: [
      "KERNEL_GUIDED_SEARCH_URL",              // web_search
      "WORKSPACEX_BROWSER_MCP_ENDPOINT",       // 浏览器工具
      "MCP_EXECUTOR_DB_USER", "MCP_EXECUTOR_DB_PASSWORD", // 远程 MCP 凭据执行
      "KERNEL_IMAGE_PROVIDER",                 // 图片生成（下面四个是它的供应商侧参数）
      "KERNEL_BAILIAN_IMAGE_BASE_URL", "KERNEL_BAILIAN_IMAGE_MODEL_ID",
      "KERNEL_BAILIAN_IMAGE_POLL_INTERVAL_MS", "KERNEL_BAILIAN_IMAGE_TIMEOUT_MS",
      "KERNEL_OPENAI_API_KEY", "KERNEL_OPENAI_ORGANIZATION", "KERNEL_OPENAI_PROJECT",
      "KERNEL_OPENAI_IMAGE_BASE_URL", "KERNEL_OPENAI_IMAGE_MODEL_ID",
      "KERNEL_OPENAI_IMAGE_TIMEOUT_MS", "OPENAI_API_KEY",
      "KERNEL_VISION_BASE_URL", "KERNEL_VISION_MODEL_ID",  // DashScope 原生视觉抽取接口
      "KERNEL_VISION_TIMEOUT_MS", "KERNEL_VISION_MAX_IMAGE_BYTES",
      "KERNEL_DEEP_RESEARCH_BASE_URL",         // 独立 deep-research 服务，本地不随包
      "KERNEL_DEEP_RESEARCH_POLL_INTERVAL_MS", "KERNEL_DEEP_RESEARCH_TIMEOUT_MS",
      // ⚠ 这三条是「默认关、按部署显式开」的新模型行为（见 thread-title-model-config.ts
      //   文件头）。云端可以慢慢灰度；本地版跑的是 5–10 tok/s 的 4B 模型，不开流式就是
      //   「点完发送盯着空白等一分钟」。归在这里是**如实登记现状**，不是认可它——
      //   R6 会把它们变成 config.ts 供给的值，届时本清单必须相应删掉这三行。
      "KERNEL_MODEL_STREAM_ENABLED", "KERNEL_DEEP_AGENT_STREAM_ENABLED",
      "KERNEL_THREAD_TITLE_MODEL_ENABLED",
    ],
  },
  {
    status: "must-stay-unset",
    reason:
      "本地版的 API 以 NODE_ENV=development 运行（它从源码跑，不是产物）。凡是判据写成 " +
      "`NODE_ENV !== production` 的逃生口，在本地版就只差这一个变量——所以「不设」必须是" +
      "会被机械核对的事实，而不是一句约定。processes.ts 的 baseEnv 还会把它们从父进程里滤掉。",
    names: [
      "KERNEL_ALLOW_TEST_PRINCIPAL", "KERNEL_AGENT_CATALOG_SCHEMA",
      "WORKSPACEX_COUNTERPROOF_INGEST", "WORKSPACEX_COUNTERPROOF_SKILL_REVIEW",
    ],
  },
];

/** `名字 → 处置`，查表用。重复名字在构造时就会被 `parityDuplicates` 抓到。 */
export function parityIndex(groups: readonly ParityGroup[] = LOCAL_ENV_PARITY): ReadonlyMap<string, ParityStatus> {
  const out = new Map<string, ParityStatus>();
  for (const g of groups) for (const n of g.names) out.set(n, g.status);
  return out;
}

/** 同一个名字出现在多组里 —— 说明有人对它的处置有两种判断。 */
export function parityDuplicates(groups: readonly ParityGroup[] = LOCAL_ENV_PARITY): readonly string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const g of groups) for (const n of g.names) (seen.has(n) ? dup : seen).add(n);
  return [...dup].sort();
}

/**
 * 扫出一棵源码树里真实读到的环境变量名。
 *
 * ⚠ 匹配 `env.X` 与 `env["X"]` 两种形态，而不只是 `process.env.X`：本仓大量函数把
 *   `NodeJS.ProcessEnv` 当参数传（`emailVerificationSecret(env = process.env)`），
 *   只扫 `process.env.` 会漏掉一半——第一版就是这么漏的。
 * ⚠ `process.env[SOME_CONST]` 这种间接读取扫不出来。它换来的是零误报；被它漏掉的名字，
 *   其定义处通常也有一次直接读取。这条限制写在这里，免得后来人以为扫描是完备的。
 */
export function scanEnvNames(roots: readonly string[]): readonly string[] {
  const re = /\benv(?:\.([A-Z][A-Z0-9_]{2,})\b|\[\s*["'`]([A-Z][A-Z0-9_]{2,})["'`]\s*\])/g;
  const names = new Set<string>();
  for (const root of roots) {
    for (const file of walkTypeScript(root)) {
      const text = readFileSync(file, "utf8");
      for (const m of text.matchAll(re)) names.add(m[1] ?? m[2] ?? "");
    }
  }
  names.delete("");
  return [...names].sort();
}

function walkTypeScript(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules") continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walkTypeScript(p, out);
    else if (p.endsWith(".ts") && !p.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

export interface ParityReport {
  /** 源码里读到、但既没供给也没归类 —— 新增变量时的缺口，测试红。 */
  readonly unclassified: readonly string[];
  /** 清单里归了类、但 `config.ts` 其实供给了 —— 两处打架，测试红。 */
  readonly classifiedButSupplied: readonly string[];
  /** 清单里有、源码里再也读不到 —— 陈旧条目，测试红（清单必须跟着代码缩）。 */
  readonly stale: readonly string[];
  /** 同一名字多组 —— 测试红。 */
  readonly duplicated: readonly string[];
}

export function parityReport(input: {
  readonly scanned: readonly string[];
  readonly supplied: Iterable<string>;
  readonly groups?: readonly ParityGroup[];
}): ParityReport {
  const groups = input.groups ?? LOCAL_ENV_PARITY;
  const index = parityIndex(groups);
  const supplied = new Set(input.supplied);
  const scanned = new Set(input.scanned);
  return {
    unclassified: input.scanned.filter((n) => !supplied.has(n) && !index.has(n)),
    classifiedButSupplied: [...index.keys()].filter((n) => supplied.has(n)).sort(),
    stale: [...index.keys()].filter((n) => !scanned.has(n)).sort(),
    duplicated: parityDuplicates(groups),
  };
}
