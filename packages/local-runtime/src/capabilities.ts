/**
 * 本地形态下**哪些能力不可用、为什么、用户能做什么** —— 唯一事实源。
 *
 * ## 为什么必须收敛成一份
 *
 * 在此之前，这件事散在至少四处：PROP §1.3 的表格、`docs/deployment/LOCAL-DESKTOP.md` 的
 * 「已知偏差」、`up()` 里几句 `warnings.push(...)`、以及 `doctor` 里几句 `findings.push(...)`
 * ——后两者还各自用**字符串前缀**判断某条发现算不算致命（`findings.every(f =>
 * f.startsWith("未找到 Ollama") || ...)`）。四份副本，而且其中两份的判据是文案本身：
 * 改一句话就会改变程序的行为。本项目已五次因「同一事实声明在两处」而漂移。
 *
 * 更要紧的是它对用户的意义。本地版对缺失能力的承诺是**如实标注，不静默失败**
 * （PROP §5 最后一条）。要做到这件事，必须先有一份「缺什么」的机器可读清单——
 * 散文做不到，`warnings.push` 里的一句中文也做不到。
 *
 * ## 这份清单与 parity.ts 的关系
 *
 * `parity.ts` 回答「这个环境变量本地为什么没有」，其中 `unavailable-locally` 那一档说的是
 * 「缺它 = 某条能力关掉了」。**那一档的每一个变量都必须在这里被某条能力认领**，由
 * `test/capabilities.test.ts` 机械核对。于是新增一个供应商形态的配置项时，写下它的人
 * 要么承认它对本地版没影响，要么必须在这里给用户一句能看懂的话——没有第三条路。
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { paths, type LocalConfig } from "./config";
import { LOCAL_ENV_PARITY } from "./parity";

export type CapabilityState =
  /** 这台机器上根本没有这条能力的实现（供应商形态，或第一版不随包）。 */
  | "unavailable"
  /** 有实现，但比云端弱；必须如实标注等级，不能假装一样。 */
  | "degraded"
  /** 缺的是一件本机可补的东西（模型、运行时、扩展包），补完就有。 */
  | "needs-install";

export interface LocalCapability {
  readonly id: string;
  readonly label: string;
  readonly state: CapabilityState;
  /** 为什么是这个状态。一句话，面向用户，不引术语。 */
  readonly because: string;
  /** 用户可以做什么。`needs-install` 必须给出确切命令；其余给出「连接云端后可用」之类的实话。 */
  readonly remedy: string;
  /**
   * 认领 `parity.ts` 里 `unavailable-locally` 档的哪些环境变量。
   * 空数组 = 这条能力的缺失不是由某个配置项缺失表达的（沙箱等级、原生会话）。
   */
  readonly envKeys: readonly string[];
}

/**
 * 与部署无关的那一部分：无论这台机器装了什么，本地版都没有这些。
 *
 * ⚠ 顺序即展示顺序：用户最可能先撞到的排前面。
 */
export const LOCAL_CAPABILITY_BASELINE: readonly LocalCapability[] = [
  {
    id: "web-search",
    label: "联网检索（web_search）",
    state: "unavailable",
    because: "检索要走公网服务，本地版承诺零出网。",
    remedy: "连接 WorkspaceX 云后可用。",
    envKeys: ["KERNEL_GUIDED_SEARCH_URL"],
  },
  {
    id: "image-generation",
    label: "图片生成",
    state: "unavailable",
    because: "随包的本地模型不会画图；图片生成是供应商侧能力。",
    remedy: "连接 WorkspaceX 云后可用。",
    envKeys: [
      "KERNEL_IMAGE_PROVIDER",
      "KERNEL_BAILIAN_IMAGE_BASE_URL", "KERNEL_BAILIAN_IMAGE_MODEL_ID",
      "KERNEL_BAILIAN_IMAGE_POLL_INTERVAL_MS", "KERNEL_BAILIAN_IMAGE_TIMEOUT_MS",
      "KERNEL_OPENAI_API_KEY", "KERNEL_OPENAI_ORGANIZATION", "KERNEL_OPENAI_PROJECT",
      "KERNEL_OPENAI_IMAGE_BASE_URL", "KERNEL_OPENAI_IMAGE_MODEL_ID",
      "KERNEL_OPENAI_IMAGE_TIMEOUT_MS", "OPENAI_API_KEY",
    ],
  },
  {
    id: "browser-tools",
    label: "浏览器工具",
    state: "unavailable",
    because: "浏览器运行时是一个独立容器，本地版不随包。",
    remedy: "连接 WorkspaceX 云后可用。",
    envKeys: ["WORKSPACEX_BROWSER_MCP_ENDPOINT"],
  },
  {
    id: "remote-mcp",
    label: "远程 MCP 调用",
    state: "unavailable",
    because: "远程 MCP 既要出网，也要一个独立的凭据执行数据库角色。",
    remedy: "连接 WorkspaceX 云后可用。",
    envKeys: ["MCP_EXECUTOR_DB_USER", "MCP_EXECUTOR_DB_PASSWORD"],
  },
  {
    id: "vendor-vision-extract",
    label: "文档/图片的供应商视觉抽取",
    state: "unavailable",
    because: "这条通路调的是 DashScope 的原生接口，不是通用的 OpenAI 兼容端点。",
    remedy: "聊天里的看图能力仍然走本地模型；批量视觉抽取连接云端后可用。",
    envKeys: [
      "KERNEL_VISION_BASE_URL", "KERNEL_VISION_MODEL_ID",
      "KERNEL_VISION_TIMEOUT_MS", "KERNEL_VISION_MAX_IMAGE_BYTES",
    ],
  },
  {
    id: "deep-research-service",
    label: "深度研究（独立服务）",
    state: "unavailable",
    because: "它是一个独立部署的服务，本地版第一版不随包。",
    remedy: "连接 WorkspaceX 云后可用。",
    envKeys: [
      "KERNEL_DEEP_RESEARCH_BASE_URL",
      "KERNEL_DEEP_RESEARCH_POLL_INTERVAL_MS", "KERNEL_DEEP_RESEARCH_TIMEOUT_MS",
    ],
  },
  {
    id: "thread-title-model",
    label: "会话名由模型总结",
    state: "degraded",
    because: "本机只有一个模型槽位，让它去起标题会推迟你真正等的那个回答。",
    remedy: "会话名取自你的第一句话，功能不缺；想要模型总结的名字，连接云端后可用。",
    envKeys: ["KERNEL_THREAD_TITLE_MODEL_ENABLED"],
  },
  {
    id: "skill-sandbox-isolation",
    label: "Skill 沙箱隔离等级",
    state: "degraded",
    because: "本地沙箱是子进程（L0），不是云端那种 network=none 的只读容器。",
    remedy: "如实标注即可；不要在本地版运行不信任来源的 skill。",
    envKeys: [],
  },
  {
    id: "native-sessions",
    label: "原生会话运行时",
    state: "unavailable",
    because: "原生会话依赖 bubblewrap，只在 Linux 容器里成立。",
    remedy: "本地版走 legacy profile + TCP 沙箱，功能等价、隔离更弱。",
    envKeys: [],
  },
];

/** 一条能力在**这台机器、这次启动**下的实际状态。 */
export interface CapabilityStatus extends LocalCapability {
  /** 本次启动里这条能力是不是真的可用。 */
  readonly available: boolean;
}

export interface CapabilityProbe {
  /**
   * 聊天模型可用吗。
   *
   * ⚠ 两种证据强度都走这一个字段，是故意的：`up()` 起完栈能给出「模型真的回了话」
   *   （`model-preflight.ts` 的一次真实调用），而 `doctor` 在没起栈时只能给出
   *   「找到了 Ollama 二进制」。调用方用它手上最强的那条证据填这里；把两者做成两个
   *   字段只会让每个读它的人再判断一次哪个更可信。
   */
  readonly chatModel: boolean;
}

/**
 * 基线 + 这台机器上可补的三件（模型 / Python 运行时 / 转写模型）。
 *
 * ⚠ 可补的那三条**不是**基线的一部分：基线是「本地版就是没有」，这三条是「你这台机器还没装」。
 *   把两者混在一张表里，正是此前 doctor 要靠字符串前缀区分致命与非致命的原因。
 */
export function localCapabilities(
  /**
   * 只需要两个路径，所以**不收** `LocalConfig`。
   * ⚠ 这不是洁癖：`resolveLocalConfig` 会顺手生成 `secrets.json`，而 `doctor` 必须是只读的
   *   ——一次自检不该在用户的数据目录里留下东西。
   */
  where: Pick<LocalConfig, "repoRoot" | "dataDir">,
  probe: CapabilityProbe,
): readonly CapabilityStatus[] {
  const installable: readonly CapabilityStatus[] = [
    {
      id: "chat-model",
      label: "聊天（本地模型）",
      state: "needs-install",
      because: "本机还没有能回话的模型（没装 Ollama，或模型没下全/装不进内存）。",
      remedy: "安装 Ollama 并确保模型下载完整，然后重启本应用；启动日志里有那次验证调用的原话。",
      envKeys: [],
      available: probe.chatModel,
    },
    {
      id: "tools-and-skills",
      label: "工具调用 / Skill 执行",
      state: "needs-install",
      because: "工具循环在 deep-agent-service 里，它需要 Python 运行时。",
      remedy: "运行 ./scripts/local-bundle/prepare-python.sh 后重启。",
      envKeys: [],
      available: existsSync(paths.deepAgentVenv(where)),
    },
    {
      id: "live-transcription",
      label: "实时转写（录音 / 访谈）",
      state: "needs-install",
      because: "本地转写模型还没下载。",
      remedy: "运行 ./scripts/local-bundle/fetch-asr-model.sh 后重启（约 300 MB，纯 CPU）。",
      envKeys: [],
      available: existsSync(join(paths.asrModelDir(where), "tokens.txt")),
    },
  ];
  return [
    ...installable,
    ...LOCAL_CAPABILITY_BASELINE.map((cap) => ({ ...cap, available: false })),
  ];
}

/**
 * 给用户看的那几行：只列**不可用**的，并且把「你能做点什么」排在「本地版就是没有」前面。
 *
 * ⚠ 刻意不合并成一句。用户要做的动作完全不同：一个是去装东西，一个是去连云端，
 *   第三个是知道别在这里跑不信任的 skill。混成一段话，三件事就都没人做。
 */
export function capabilityNotices(statuses: readonly CapabilityStatus[]): readonly string[] {
  return statuses
    .filter((s) => !s.available)
    .map((s) => `${s.label}：${s.because} ${s.remedy}`);
}

/** `parity.ts` 里 `unavailable-locally` 档但没有任何能力认领的变量 —— 测试红。 */
export function unclaimedUnavailableEnv(
  capabilities: readonly LocalCapability[] = LOCAL_CAPABILITY_BASELINE,
): readonly string[] {
  const claimed = new Set(capabilities.flatMap((c) => c.envKeys));
  const declared = LOCAL_ENV_PARITY
    .filter((g) => g.status === "unavailable-locally")
    .flatMap((g) => g.names);
  return declared.filter((n) => !claimed.has(n)).sort();
}

/** 认领了、但 `parity.ts` 根本没把它归进 `unavailable-locally` 的变量 —— 同样是两处打架。 */
export function overclaimedEnv(
  capabilities: readonly LocalCapability[] = LOCAL_CAPABILITY_BASELINE,
): readonly string[] {
  const declared = new Set(
    LOCAL_ENV_PARITY.filter((g) => g.status === "unavailable-locally").flatMap((g) => g.names),
  );
  return capabilities.flatMap((c) => c.envKeys).filter((n) => !declared.has(n)).sort();
}
