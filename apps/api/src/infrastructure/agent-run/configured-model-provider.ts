/**
 * The ONE configured model provider (Wave 2 delta §5).
 *
 * ## Why this class cannot fall back, structurally
 *
 * It holds a single `provider` string and a single base URL. There is no list, no map, no
 * "default", and `complete()` refuses any `modelProvider` that is not the configured one.
 * The failure §5 forbids -- a run answered by a provider its pinned Agent version does not
 * name -- would require adding a second endpoint here, which needs a review.
 *
 * ## Nothing the provider says reaches a client
 *
 * Every failure becomes `ModelCallError(code, detail)`. `code` is one of the contract's
 * enumerated values; `detail` is a short server-side string built HERE, from the status
 * line and a category, never from the response body and never from `String(err)`. PR #310
 * shipped the other version of this, and the lesson is not "remember to redact" -- it is
 * that the redacted thing must be the only thing that exists.
 *
 * ## The request shape
 *
 * OpenAI-compatible `/chat/completions`, which is what the providers this deployment
 * targets (and their self-hosted stand-ins) speak. `complete()` always sends `stream:
 * false` -- that half of #654 阶段2a's own doc comment is still true for THIS method.
 *
 * ## `completeStream` is OFF by default (#654 阶段2a)
 *
 * `KERNEL_MODEL_STREAM_ENABLED` gates whether `this.completeStream` exists AT ALL, read
 * once here at composition time same as everything else in this config. Measured, not
 * assumed: turning this on unconditionally the moment the method existed broke 8 of
 * `no-tool-run-writeback.test.ts`'s currently-passing assertions, because every call
 * started sending `stream: true` and the existing stub server (and, by the same logic,
 * any real deployment nobody has verified end-to-end yet) does not speak SSE back --
 * `execute-run.ts` uses `deps.model.completeStream`'s mere PRESENCE to decide which path
 * to take, so a provider that unconditionally defines the method changes the behaviour
 * of every run through it, not just ones that opted in. The flag is what "opting in"
 * actually means here: default `0` reproduces every byte of pre-阶段2a behaviour, and
 * turning it on is a deliberate, separately-reviewable rollout step, not a side effect
 * of this PR merging.
 *
 * ## `tools`/tool calls (#725) -- retired by #741
 *
 * This adapter used to map `input.tools`/`input.toolExchange` to the OpenAI-compatible
 * `tools[].function.*` wire fields and parse `message.tool_calls` back out, for the TS
 * in-process tool loop `execute-run.ts` used to run. That loop is gone (see that file's
 * own header) and `ModelCallInput`/`ModelCallPort.complete()` no longer carry those fields
 * at all (`ports.ts`'s own header) -- this class went back to the pre-#725 request/response
 * shape, not a shape that merely stopped being exercised.
 */
import { randomUUID } from "node:crypto";
import { Agent, fetch as undiciFetch, type Response as UndiciResponse } from "undici";
import type {
  ModelCallImage, ModelCallInput, ModelCallPort, ModelCallCompletion, ModelDeltaMetadata,
} from "../../application/agent-run/ports";
import { ModelCallError } from "../../application/agent-run/ports";
import type { ReportedUsage } from "../../application/agent-run/ports";

export interface ConfiguredModelProviderConfig {
  /** The one provider name that runs may pin. Empty means: this deployment has none. */
  readonly provider: string;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly timeoutMs: number;
  /** #654 阶段2a. Default `false` -- see this file's own header for why. */
  readonly streamEnabled: boolean;
  /**
   * P2（#1561）—— 这个部署认为**哪些 modelId 真的能看图**。
   *
   * ⚠ **默认值未经实测确认，见本文件「视觉输入」那节头注。** 一个 modelId 不在这个集合里，
   * `supportsVision` 就回 false，`execute-run.ts` 走诚实降级（告诉模型它看不到图），
   * 而不是把字节丢给一个可能不认识它的端点。集合为空 = 这个部署没有任何视觉模型。
   */
  readonly visionModelIds: ReadonlySet<string>;
  /**
   * #2504 —— 这个部署认为**哪些 modelId 是"可以安全关闭 thinking 的 Bailian 混合思考
   * 模型"**。见 `postCompletions` 头注：`enable_thinking` 是阿里云百炼（Model Studio）
   * 的专有扩展字段，不是 OpenAI 标准字段——同一份代码理论上可以指向别的 OpenAI 兼容
   * 端点（这个类本身是通用 adapter，只是**这个部署**只配了一个 provider），对不认识
   * 这个字段的端点，多发一个陌生字段有 4xx 的风险；即使同样是百炼，`thinking-only`
   * 模型（只能思考、不能关）收到 `enable_thinking: false` 会被拒绝，不是被忽略。
   * 一个 modelId 不在这个集合里 ⇒ 不发这个字段，行为回落到"不管超时"的原始状态——
   * 与 `supportsVision` 同一纪律：只对已确认支持的能力打开，不对未知的裸猜。
   *
   * ⚠ **只是 model 维度的能力声明，不是"这个部署配的就是百炼"的证明**——那一半由
   * `bailianExtensionsEnabled` 单独判定，见其头注。两者都为真才发这个字段（`postCompletions`
   * 里的门控），这是独立复审诊断（PR #2640）指出的"provider/model 双维能力"要求。
   */
  readonly thinkingDisableModelIds: ReadonlySet<string>;
  /**
   * #2504（独立复审诊断收紧）—— 这个部署的 `baseUrl` **是不是**真的指向一个认识
   * `enable_thinking` 这个百炼专有扩展字段的端点。
   *
   * 只有 `thinkingDisableModelIds` 一个维度不够：那只声明了"这个 modelId 支持关闭
   * thinking"，没有回答"这个部署配的端点是不是百炼"——一个复用本类（通用 OpenAI
   * 兼容 adapter）但指向别的厂商/自托管端点的部署，即使调用时传的 modelId 字符串
   * 恰好复用了 `qwen-plus`/`qwen3.7-plus` 这两个名字（例如自建的开源同名模型），也
   * 不该被发送这个陌生字段。
   *
   * 默认值：`baseUrl` 命中 `dashscope.aliyuncs.com`（`bailian-image-provider.ts` /
   * `bailian-vision-extractor.ts` 用的同一个真实百炼 host）就认为是。命不中时默认为
   * `false`——不是"大概率也是百炼"的猜测，是诚实地不知道。运维可以用
   * `KERNEL_MODEL_BAILIAN_EXTENSIONS=1`/`=0` 显式覆盖（例如百炼在私有网络/代理后面，
   * `baseUrl` 不含这个域名，但确实是百炼）。
   */
  readonly bailianExtensionsEnabled: boolean;
}

/** Read once at composition time, so a mid-flight env change cannot swap a run's provider. */
export function readModelProviderConfig(
  env: NodeJS.ProcessEnv = process.env,
): ConfiguredModelProviderConfig {
  // ⚠ 2026-08-07 devapp 实测：默认 60s 在「一个 agent 挂了多个 skill（每个 skill 的
  // SKILL.md 全文都拼进 system prompt）」时会真实超时——不是偶发，同一条较长的用户
  // 请求连续两次都在 model_called 步骤精确卡在 60000ms 失败（MODEL_CALL_FAILED），
  // 而一句"重试一次"这种短请求秒回。系统提示词越长，模型生成越慢，60s 对"多技能挂载
  // 的默认 agent"这个真实场景不够用。180s 仍在 R9（>10s 转异步任务）判定之内的同步
  // 路径可接受范围——这条超时挡的是"网络/模型真的挂了"，不是"提示词长+回复长"。
  // ⚠ 2026-08-19（#1611）：在此之前这个值 **> 300000 的部分是静默失效的**——内建 fetch
  // 走 undici，`headersTimeout` 默认 300s 且独立于 `AbortSignal`。现在两处出网都走显式
  // dispatcher（见 `ConfiguredModelProvider#dispatcher`），这个数字才真的说了算。
  const timeout = Number(env.KERNEL_MODEL_TIMEOUT_MS ?? "180000");
  const baseUrl = (env.KERNEL_MODEL_BASE_URL ?? "").trim().replace(/\/+$/, "");
  return {
    provider: (env.KERNEL_MODEL_PROVIDER ?? "").trim(),
    baseUrl,
    apiKey: env.KERNEL_MODEL_API_KEY ?? "",
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : 180_000,
    streamEnabled: env.KERNEL_MODEL_STREAM_ENABLED === "1",
    visionModelIds: readVisionModelIds(env),
    thinkingDisableModelIds: readThinkingDisableModelIds(env),
    bailianExtensionsEnabled: readBailianExtensionsEnabled(env, baseUrl),
  };
}

/**
 * #2504（独立复审诊断收紧）—— `bailianExtensionsEnabled` 的判定逻辑，从 `readModelProviderConfig`
 * 拆出来单独可测：`KERNEL_MODEL_BAILIAN_EXTENSIONS` 显式覆盖优先（`"1"`/`"0"`），未设置时
 * 按 `baseUrl` 是否命中真实百炼 host 自动判定。见 `bailianExtensionsEnabled` 头注。
 */
export function readBailianExtensionsEnabled(env: NodeJS.ProcessEnv, baseUrl: string): boolean {
  const override = env.KERNEL_MODEL_BAILIAN_EXTENSIONS;
  if (override === "1") return true;
  if (override === "0") return false;
  return isBailianBaseUrl(baseUrl);
}

/**
 * `bailian-image-provider.ts` / `bailian-vision-extractor.ts` 用的同一个真实百炼 host——
 * 严格按 `URL.hostname` 判定，不是子串匹配。
 *
 * ⚠ 第三轮独立复审诊断指出：`baseUrl.includes("dashscope.aliyuncs.com")` 是子串匹配，
 * 对 `https://dashscope.aliyuncs.com.attacker.example/v1`（伪造子域）、
 * `https://evil.example/dashscope.aliyuncs.com`（字符串藏在 path 里）这类 URL 会误判为
 * 真的百炼——这正是子串匹配当 host 校验用时的经典坑，与"字符串里含某个词"和"域名真的是
 * 那个域"是两件事同源。改成解析出 `hostname` 再判等值（含 `www.` 前缀，真实生产环境两种
 * 写法都可能出现），解析失败（`baseUrl` 不是合法 URL）fail closed 为 false——与整个文件
 * 「未知能力不裸猜」的纪律一致，不是"看起来像就当真的"。
 */
function isBailianBaseUrl(baseUrl: string): boolean {
  let hostname: string;
  try {
    hostname = new URL(baseUrl).hostname;
  } catch {
    return false;
  }
  return hostname === "dashscope.aliyuncs.com" || hostname === "www.dashscope.aliyuncs.com";
}

/**
 * P2（#1561）—— `KERNEL_MODEL_VISION_IDS`（逗号分隔）→ 允许走多模态请求体的 modelId 集合。
 *
 * ⚠ 默认值 `qwen-vl-max,qwen-vl-plus` **没有在本次开发环境实测过**（本机没有
 * `KERNEL_MODEL_API_KEY`，探测不了）。`bailian-image-provider.ts:14-15` 记着这件事上
 * 栽过的跟头：`wanx2.2-t2i-plus` 报 "Model not exist"、`wanx2.1-t2i-plus` 才可用，
 * 「不要被"2.2 应该比 2.1 新"这种直觉带偏」。同样的直觉在这里也不作数——这两个名字是
 * 待验证的候选，不是已验证的事实。有 key 的环境跑
 * `node apps/api/scripts/probe-bailian-vision.mjs` 一条命令即可确认，把实测通过的名字
 * 写进 env（或改这里的默认值并把实测记录写进注释）。在那之前，如果默认值是错的，
 * 表现是**诚实的失败**（模型名不存在 → `MODEL_CALL_FAILED`），不是一个假装看过图的回答。
 */
function readVisionModelIds(env: NodeJS.ProcessEnv): ReadonlySet<string> {
  const raw = env.KERNEL_MODEL_VISION_IDS ?? "qwen-vl-max,qwen-vl-plus";
  return new Set(raw.split(",").map((v) => v.trim()).filter((v) => v !== ""));
}

/**
 * #2504 —— `KERNEL_MODEL_THINKING_DISABLE_IDS`（逗号分隔）→ 非流式请求里允许带
 * `enable_thinking: false` 的 modelId 集合。
 *
 * ⚠ 默认值 `qwen-plus,qwen3.7-plus`（+2026-09-06 的 `qwen3.8-max`）是**这个仓库自己已经在用**的 Bailian 混合思考
 * 模型 id（`deep_agent_service/model.py` 的 `DEFAULT_MODEL_ID`、
 * `simulate-template-run.ts`/`suggest-template-sections.ts`/
 * `guided-*-generator.ts` 的 `modelId` 常量），不是凭空猜的——两者都是"混合模型"
 * （hybrid，thinking 可开可关），不是 thinking-only 变体。**没有实测确认 pptx skill
 * 默认 agent 实际用的是哪个 modelId**（它来自数据库配置的 per-agent 值，见
 * `pg-default-agent-repository.ts` 头注，这个文件看不到）——如果部署的实际值不在这
 * 两个里，运维需要把它加进 `KERNEL_MODEL_THINKING_DISABLE_IDS`，这条修复才对那个
 * modelId 生效；在那之前，行为是**诚实地不生效**（不发这个字段，超时未缓解），不是
 * 假装缓解了。同样的纪律见 `readVisionModelIds` 头注。
 */
function readThinkingDisableModelIds(env: NodeJS.ProcessEnv): ReadonlySet<string> {
  // 2026-09-06 —— 补 `qwen3.8-max`：devapp 实际部署的 deep-agent 模型（见 `model.py`
  // `_DEFAULT_THINKING_DISABLE_MODEL_IDS` 旁注），百炼文档列为混合思考、默认开 thinking。
  // 两边默认值必须逐字相同（`apps/deep-agent-service/tests/test_model.py` 机械比对）。
  const raw = env.KERNEL_MODEL_THINKING_DISABLE_IDS ?? "qwen-plus,qwen3.7-plus,qwen3.8-max";
  return new Set(raw.split(",").map((v) => v.trim()).filter((v) => v !== ""));
}

/**
 * #709 -- the OpenAI-compatible `messages` array, system first, then whatever prior turns
 * `execute-run.ts` already trimmed to budget (`input.history ?? []` -- see `ModelCallInput`'s
 * own doc comment for why this is `?? []` rather than a required field), then the current
 * turn last. Shared by `complete()` and `streamImpl()` so the two request bodies cannot
 * drift on how history gets spliced in -- they already share every other field of this
 * request shape, and a second inlined copy is exactly the kind of duplication this
 * repository's own discipline (AGENTS.md: "同一事实不得声明在两处") calls out by name.
 */
/**
 * One OpenAI-compatible `messages[]` entry.
 *
 * P2（#1561）：`content` 从 `string` 放宽成「string 或 part 数组」——OpenAI 兼容的多模态
 * 形态。⚠ **只有带图的那一条 user 消息会变成数组**，其余每一条逐字节保持 `string`：
 * 一个不带图的请求体因此与 P2 之前**完全相同**，不需要任何部署去验证"我们的上游认不认
 * 数组形态"。
 */
type WireContent = string | readonly WireContentPart[];

type WireContentPart =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "image_url"; readonly image_url: { readonly url: string } };

interface WireMessage {
  readonly role: string;
  readonly content: WireContent;
}

/**
 * P2（#1561）—— 一张图 → 一个 `image_url` part。
 *
 * 编码成 data URL（`data:<mime>;base64,<...>`）而不是传一个可访问的 URL：附件字节住在本
 * 部署的对象存储里，没有对外可达的签名 URL 通路，造一条出来等于给用户上传的图开一个
 * 公网可读面——那是一个需要单独评审的隐私决定，不是这个 PR 顺手能做的事。data URL 的
 * 代价是请求体按 4/3 膨胀，这正是 `MODEL_CALL_MAX_IMAGE_BYTES` 存在的原因。
 */
function toImagePart(image: ModelCallImage): WireContentPart {
  const base64 = Buffer.from(image.bytes).toString("base64");
  return { type: "image_url", image_url: { url: `data:${image.mime};base64,${base64}` } };
}

/** #709's system/history/user shape -- shared by `complete()` and `streamImpl()` so the two
 * request bodies cannot drift on how history gets spliced in. */
function buildMessages(input: ModelCallInput): readonly WireMessage[] {
  const images = input.images ?? [];
  // 没有图 ⇒ 走与 P2 之前逐字节相同的纯字符串形态（见 `WireMessage` 头注）。
  const userContent: WireContent = images.length === 0
    ? input.user
    : [{ type: "text", text: input.user } as const, ...images.map(toImagePart)];
  return [
    { role: "system", content: input.system },
    ...(input.history ?? []).map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: userContent },
  ];
}

/**
 * F159 —— `usage` 三个字段一起声明。
 *
 * ⚠ 在此之前这里只声明了 `total_tokens`，另外两个**一直在线上、一直被丢掉**：
 * 打的是 OpenAI 兼容接口，`usage` 对象本来就带 `prompt_tokens` / `completion_tokens`。
 * 「上游给不到所以不能拆 in/out」这个判断（曾被记为具名缺口 GAP-TOKEN-IO-SPLIT）
 * 是错的——错在没去读线上真实响应，只读了我们自己的解析类型。
 */
interface WireUsage {
  total_tokens?: unknown;
  prompt_tokens?: unknown;
  completion_tokens?: unknown;
}

interface CompletionResponse {
  choices?: { message?: { content?: unknown } }[];
  usage?: WireUsage;
}

/** One OpenAI-compatible `chat.completion.chunk` SSE payload. */
interface CompletionChunk {
  choices?: { delta?: { content?: unknown }; finish_reason?: unknown }[];
  usage?: WireUsage;
}

/** 非负有限数才算「报了」；其它一律 `undefined`（没报），不在这一层造 0。 */
function readCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/** 线上 `usage` → 端口的 `ReportedUsage`。三维各自可缺。 */
function readUsage(usage: WireUsage | undefined): ReportedUsage {
  return {
    total: readCount(usage?.total_tokens),
    prompt: readCount(usage?.prompt_tokens),
    completion: readCount(usage?.completion_tokens),
  };
}

/**
 * #1611 —— `AbortSignal` 相对网络层超时的宽限，毫秒。
 *
 * 两个超时**不是同一件事**：`headersTimeout` / `bodyTimeout` 管的是「连接上多久没有
 * 新字节」，`AbortSignal` 管的是整通调用的 wall-clock 上限。让 abort 严格晚于网络层
 * 超时，是为了让**先触发的那个是能说清原因的那个**——否则 header 停顿会被 abort 抢先
 * 打断，失败原因塌回一个笼统的 "aborted"，正是本 issue 要消灭的那种信息销毁。
 */
const ABORT_GRACE_MS = 2_000;

/**
 * #1611 —— 允许进入服务端日志的传输失败**枚举**白名单。
 *
 * 原实现是裸 `catch {}`，动机（错误 `message` 里常有主机、端口，有时是带凭据的 URL）
 * **是对的**。修法不是"什么都不看"，而是**只看枚举字段**（`err.cause.code` /
 * `err.name`）：这些取值来自 Node/undici 的固定常量表，本身不含任何部署信息。
 * `message` 在本文件里一个字都不读、不入库、不透出。
 */
const TRANSPORT_CAUSE_CODES: ReadonlySet<string> = new Set([
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
  "UND_ERR_CLOSED",
  "UND_ERR_DESTROYED",
  "UND_ERR_ABORTED",
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ETIMEDOUT",
  "EPIPE",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "CERT_HAS_EXPIRED",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
]);

/**
 * 传输失败 → 一个白名单枚举 token。不在白名单里的一律 `UNCLASSIFIED`——**不回显**未知
 * 取值，否则白名单形同虚设（未知 `code` 理论上可以是上游造出来的任意字符串）。
 */
export function classifyTransportError(err: unknown): string {
  const e = err as {
    readonly name?: unknown;
    readonly cause?: { readonly code?: unknown; readonly errors?: readonly { readonly code?: unknown }[] };
  } | null | undefined;
  const code = e?.cause?.code;
  if (typeof code === "string" && TRANSPORT_CAUSE_CODES.has(code)) return code;
  // 双栈（IPv4/IPv6 各试一次）失败时 undici 把 cause 包成 AggregateError，真正的 code 在
  // `errors[]` 里。实测过：单栈是 `cause.code`，双栈是 `cause.errors[0].code`——只认前者
  // 会让一整类失败退回 UNCLASSIFIED。
  for (const inner of e?.cause?.errors ?? []) {
    if (typeof inner?.code === "string" && TRANSPORT_CAUSE_CODES.has(inner.code)) return inner.code;
  }
  if (typeof e?.name === "string" && TRANSPORT_CAUSE_CODES.has(e.name)) return e.name;
  if (e?.name === "AbortError" || e?.name === "TimeoutError") return "ABORTED";
  return "UNCLASSIFIED";
}

export class ConfiguredModelProvider implements ModelCallPort {
  private readonly config: ConfiguredModelProviderConfig;

  /**
   * Present ONLY when `config.streamEnabled` -- an explicit constructor-body assignment,
   * not a class-field initializer, so there is no ambiguity about whether `this.config`
   * is set before this decision runs. `execute-run.ts` treats the mere presence of this
   * property as "this port can stream", so the ternary here IS the opt-in gate, not just
   * an implementation detail.
   */
  readonly completeStream?: (
    input: ModelCallInput,
    onDelta: (delta: string, metadata?: ModelDeltaMetadata) => Promise<void>,
  ) => Promise<ModelCallCompletion>;

  constructor(config: ConfiguredModelProviderConfig) {
    this.config = config;
    this.completeStream = config.streamEnabled
      ? (input, onDelta) => this.streamImpl(input, onDelta)
      : undefined;
  }

  /**
   * #1611 —— 让 `KERNEL_MODEL_TIMEOUT_MS` 真的说了算的那个 dispatcher。
   *
   * Node 内建 `fetch` 走 undici，其 `headersTimeout` / `bodyTimeout` **默认 300s，且
   * 独立于 `AbortSignal` 生效**——本机 Node v22.23.1 实测：不设 headersTimeout、
   * `AbortSignal` 给 600s，调用在 **301.5s** 抛 `cause.code = UND_ERR_HEADERS_TIMEOUT`。
   * 也就是说在此之前，`KERNEL_MODEL_TIMEOUT_MS` 任何 > 300000 的取值都**静默失效**：
   * 配置项看着生效（无报错无告警），实际被一个更小的隐含上限压着。pptx skill（20KB
   * system prompt，真实上游单次调用实测 120s，重试轮上下文更长）因此连续两次拿不到
   * 结果，且原因不可见。
   *
   * ## 为什么 `fetch` 也从 `undici` 导入，而不是内建 fetch + npm undici 的 Agent
   *
   * 后者本机实测能工作（duck-typed `dispatch()`），但那是**跨 undici 实例**传
   * dispatcher：内建 fetch 用的是 Node 自带的那份 undici，npm 那份是另一份，两者的
   * 内部契约没有任何东西保证它们在 Node 或 undici 升级后仍然对得上，而失配的表现会是
   * "超时配置又悄悄不生效了"——本 issue 修的正是这一类静默失效。两边都从同一个
   * `undici` 导入，dispatcher 与消费它的 fetch 出自同一实例，且 `dispatcher` 本来就在
   * undici 自己的 `RequestInit` 类型里（内建 fetch 的标准 `RequestInit` 没有它，那条
   * 路还得靠类型断言绕过 tsc）。代价：多一个显式依赖，以及请求走 npm undici 而非
   * Node 内建那份——请求/响应形态本身两者一致（同一实现的不同版本）。
   */
  private agent?: Agent;

  private dispatcher(): Agent {
    this.agent ??= new Agent({
      headersTimeout: this.config.timeoutMs,
      bodyTimeout: this.config.timeoutMs,
    });
    return this.agent;
  }

  /** 释放连接池。长驻进程里不需要；测试里调用它，免得 vitest 抱着 socket 不退出。 */
  async close(): Promise<void> {
    const agent = this.agent;
    this.agent = undefined;
    await agent?.close();
  }

  /**
   * 两个调用点（`complete()` / `streamImpl()`）**唯一**的出网口。
   *
   * 合成一处不是顺手重构：#1611 的根因就是「超时配置只覆盖了一半的层」，而两份逐字
   * 复制的 fetch 调用正是下一次只改一处的温床。两者的差别只有 `stream` 这一个字段。
   *
   * ## `enable_thinking: false`（非流式时）—— #2504
   *
   * ⚠ 这个部署配的是通义千问（阿里云百炼，`baseUrl`/`apiKey` 见本文件头注）。Qwen3 系
   * 模型（`qwen-plus`/`qwen3.x-plus` 等，见各调用点的 `modelId` 常量）**缺省开启深度
   * 思考**：模型在给出最终答案前先生成一段隐藏的 reasoning，而 `complete()` 恒为
   * `stream: false`（本文件头注「The request shape」），调用方要等整段思考 + 正文都
   * 生成完才拿到响应——2026-09-02 用户反馈：提交一个信息量较大的 pptx 任务，等了
   * 300+ 秒后超时（#2504）。pptx skill 的 system prompt 本来就大（#1611 头注提过的
   * 20KB），思考阶段在这种输入上被进一步拉长，叠加 #1611 已经放宽到的 180s 超时依然
   * 不够。这里不是"超时还不够长"——继续调大超时只是把用户等待的时间挪个地方，思考
   * 阶段本身对 pptx/大纲这类结构化生成任务没有必要，显式关闭它而不是继续加长预算。
   *
   * 只在 `stream` 为 false 时关：流式路径（`streamEnabled`，默认关闭，见类头注）会把
   * 思考过程边生成边吐给调用方，不是本 issue 命中的"整段等待"场景，改它属于另一个
   * 决策，不在这次修复范围内。
   *
   * ⚠ #2700 —— `apps/deep-agent-service` 的 deep-agent 主聊天路径是一套完全独立的
   * Python/LangGraph 代码（不复用这个 TS adapter），命中同一个根因（`ChatOpenAI` 默认
   * 非流式 + Qwen3 缺省开 thinking），已在 `deep_agent_service/model.py::build_chat_model`
   * 用同名环境变量（`KERNEL_MODEL_THINKING_DISABLE_IDS`/`KERNEL_MODEL_BAILIAN_EXTENSIONS`）
   * 和逐字相同的双维门控独立实现了一份镜像修复——两处判断逻辑改动时必须同步，不能
   * 只改一处产生行为漂移。
   *
   * ⚠ **双维门控，都为真才发**（独立复审诊断进一步收紧，见 `thinkingDisableModelIds` /
   * `bailianExtensionsEnabled` 各自头注）：
   *   1. `config.thinkingDisableModelIds.has(input.modelId)` —— **model** 维度："这个
   *      modelId 是已知支持关闭 thinking 的混合模型"；
   *   2. `config.bailianExtensionsEnabled` —— **endpoint** 维度："这个部署配的 baseUrl
   *      真的是百炼"，不是复用本类（通用 OpenAI-compatible adapter）指向别的厂商/
   *      自托管端点、只是恰好也用了同一个 modelId 字符串。
   * 只判一维不够：只看 modelId，一个复用了 `qwen-plus` 这个名字的非百炼自托管端点也会
   * 被发送这个陌生字段；只看 endpoint，百炼里的 `thinking-only` 模型（只能思考、不能关）
   * 收到 `enable_thinking: false` 会被拒绝、不是被忽略。两维都不满足 ⇒ 完全不带这个
   * 字段，请求体与本次修复之前逐字节相同。
   */
  private async postCompletions(input: ModelCallInput, stream: boolean): Promise<UndiciResponse> {
    const { baseUrl, apiKey, timeoutMs } = this.config;
    // AbortSignal 保留：它管的是整通调用的 wall-clock 上限，与 headersTimeout /
    // bodyTimeout（「多久没有新字节」）互补，不是同一件事，删掉任何一个都会留下缺口。
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), timeoutMs + ABORT_GRACE_MS);
    try {
      return await undiciFetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        signal: abort.signal,
        dispatcher: this.dispatcher(),
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: input.modelId,
          stream,
          messages: buildMessages(input),
          ...(!stream
            && this.config.bailianExtensionsEnabled
            && this.config.thinkingDisableModelIds.has(input.modelId)
            ? { enable_thinking: false }
            : {}),
        }),
      });
    } catch (err) {
      // 传输错误对象**只**被读一个枚举字段（见 `classifyTransportError`）。`message`
      // 一个字都不读：它常含主机、端口，有时是带凭据的 URL。枚举 token 进的是
      // `detail`，而 `detail` 只进服务端日志，从不进响应（见本文件头注）。
      throw new ModelCallError(
        "MODEL_CALL_FAILED",
        `model provider transport failure (${classifyTransportError(err)})`,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * P2（#1561）—— 本 provider 下**这个 modelId** 能不能真的看到图。
   *
   * 判据是部署期配置的 `visionModelIds`（`KERNEL_MODEL_VISION_IDS`），不是"我是 dashscope
   * 所以我能看图"：同一个 DashScope key 下绝大多数模型是纯文本的，只有 VL 系列有视觉输入。
   * 能力是**模型**的属性，不是厂商的属性——把它当成厂商属性，结果就是给一个纯文本模型发
   * 多模态请求体，运气好报错、运气不好它把图 part 忽略掉正常回一段话，而那正是 #1558
   * 那种"用户以为模型看过了"的形态。
   */
  supportsVision(modelProvider: string, modelId: string): boolean {
    return modelProvider === this.config.provider && this.config.visionModelIds.has(modelId);
  }

  async complete(input: ModelCallInput): Promise<
    { readonly text: string; readonly tokens?: number; readonly promptTokens?: number; readonly completionTokens?: number }
  > {
    const { provider, baseUrl, apiKey } = this.config;
    if (provider === "" || baseUrl === "" || apiKey === "") {
      throw new ModelCallError(
        "MODEL_PROVIDER_NOT_CONFIGURED",
        "no model provider is configured for this deployment",
      );
    }
    if (input.modelProvider !== provider) {
      // Not a fallback point. The run pinned a provider this deployment does not serve,
      // and answering with the one it does serve would silently change the snapshot.
      throw new ModelCallError(
        "MODEL_PROVIDER_NOT_CONFIGURED",
        `run pinned provider "${input.modelProvider}", configured provider is "${provider}"`,
      );
    }

    const response = await this.postCompletions(input, false);

    if (!response.ok) {
      /*
       * F159（coord-main 裁决②修正）—— 失败体里**只**取 `usage` 的三个数字。
       *
       * 这里原本一个字节都不读，理由写在原注释里：错误体常带 host / port / 有时是带
       * 凭据的 URL。那条纪律没有松动——下面读出来的只有 `usage` 里的数字，错误文本
       * 依然不进 `detail`、不进日志、不进任何响应。之所以要读：部分 4xx 上游照样计费
       * prompt tokens 并把 usage 放在错误体里，一律记 0 会让那部分钱在账上凭空消失。
       * 读不动（非 JSON / 体已被消费）就当没报，不让它影响失败本身。
       */
      let failedUsage: ReportedUsage | undefined;
      try {
        failedUsage = readUsage(((await response.json()) as CompletionResponse).usage);
      } catch {
        failedUsage = undefined;
      }
      throw new ModelCallError(
        "MODEL_CALL_FAILED",
        `model provider responded with HTTP ${response.status}`,
        failedUsage,
      );
    }

    let parsed: CompletionResponse;
    try {
      parsed = await response.json() as CompletionResponse;
    } catch {
      throw new ModelCallError("MODEL_CALL_FAILED", "model provider response was not JSON");
    }
    const message = parsed.choices?.[0]?.message;
    const content = message?.content;
    if (typeof content !== "string" || content.trim() === "") {
      throw new ModelCallError("MODEL_CALL_FAILED", "model provider returned no content");
    }
    // Read straight off the wire response, never computed. Absent or non-numeric ⇒
    // `undefined` (the port's "not reported" state) -- not `0` invented at this layer.
    const usage = readUsage(parsed.usage);
    return { text: content, tokens: usage.total, promptTokens: usage.prompt, completionTokens: usage.completion };
  }

  /**
   * #654 阶段2a — the streaming variant, only reachable via `this.completeStream` when
   * `streamEnabled` (see constructor). Same request shape as `complete()`, `stream: true`
   * instead of `false`, and the SSE body is decoded incrementally: each
   * `chat.completion.chunk`'s `choices[0].delta.content` is handed to `onDelta` the moment
   * it arrives, in order. The final `{ text, tokens }` is the concatenation of every
   * fragment -- the SAME shape `complete()` returns, not a different contract.
   *
   * Whatever the provider says on failure NEVER reaches the caller here either: every
   * error path collapses to the same enumerated `ModelCallError` codes `complete()` uses.
   */
  private async streamImpl(
    input: ModelCallInput,
    onDelta: (delta: string, metadata?: ModelDeltaMetadata) => Promise<void>,
  ): Promise<ModelCallCompletion> {
    const { provider, baseUrl, apiKey } = this.config;
    if (provider === "" || baseUrl === "" || apiKey === "") {
      throw new ModelCallError(
        "MODEL_PROVIDER_NOT_CONFIGURED",
        "no model provider is configured for this deployment",
      );
    }
    if (input.modelProvider !== provider) {
      throw new ModelCallError(
        "MODEL_PROVIDER_NOT_CONFIGURED",
        `run pinned provider "${input.modelProvider}", configured provider is "${provider}"`,
      );
    }

    const response = await this.postCompletions(input, true);

    if (!response.ok) {
      throw new ModelCallError(
        "MODEL_CALL_FAILED",
        `model provider responded with HTTP ${response.status}`,
      );
    }
    if (response.body === null) {
      throw new ModelCallError("MODEL_CALL_FAILED", "model provider returned no stream body");
    }

    // This adapter emits one assistant message per completion, unlike a tool graph.
    // The same identity binds every streamed fragment to its final completion.
    const finalMessageId = randomUUID();
    let text = "";
    let usage: ReportedUsage = {};
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        // issue #2104 —— **先归一化行尾，再找帧边界**。SSE 规范（WHATWG）允许行以
        // CRLF / CR / LF 结束；上游一旦说 CRLF（任何基于 sse-starlette 的实现，其默认
        // 分隔符就是 `\r\n`），真实帧分隔符是 `\r\n\r\n`——里面**不含** `\n\n` 子串。
        // 下面那句 `indexOf("\n\n")` 于是一帧都切不出来：整条流被读完却零个事件被解析，
        // 不抛错也不告警（HTTP 200、body 正常读完、reader 正常 done），流式静默降级成
        // 一次性整段回复。这与 #2098 在 `deep-agent-model-provider.ts` 上的根因同形。
        //
        // ⚠ 今天这里没炸，只是因为现接的 OpenAI 兼容上游都发 LF——那是「只对一种方言
        //   正确」，不是「正确」。#2098 那个 bug 能在一套**显式断言 token 级流式**的反证
        //   套件下存活整年，正是因为所有替身都只说 LF。
        //
        // 归一化放在**每轮对整个剩余 buffer** 做，而不是只对本次 decode 的分片做：
        // 一个 `\r\n` 可能被 TCP 分片从中间劈开（`\r` 落在上一片尾、`\n` 落在下一片头），
        // 只归一化分片会漏掉它；对整个 buffer 重复归一化是幂等的，那个残留的 `\r` 会在
        // 下一轮与新到的 `\n` 合并后被正确吃掉。
        //
        // 逐行解析那侧不需要动：`line.trim()` 本来就会吃掉行尾残留的 `\r`，坏掉的
        // **只有帧边界**这一处。
        buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, "\n");
        // SSE frames are separated by a blank line; a frame may still be incomplete at the
        // end of `buffer` (the socket delivered a partial frame), so only fully-terminated
        // ones are consumed here and the remainder stays for the next read.
        let boundary = buffer.indexOf("\n\n");
        while (boundary !== -1) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          boundary = buffer.indexOf("\n\n");
          for (const line of frame.split("\n")) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue; // SSE comments/keep-alives: not data.
            const payload = trimmed.slice("data:".length).trim();
            if (payload === "[DONE]") continue;
            let chunk: CompletionChunk;
            try {
              chunk = JSON.parse(payload) as CompletionChunk;
            } catch {
              // A malformed frame is a wire hiccup, not proof the whole call failed --
              // `complete()` already treats "not JSON" as fatal for the ONE reply it gets;
              // here one bad frame among dozens is not that same signal, so it is skipped.
              continue;
            }
            const delta = chunk.choices?.[0]?.delta?.content;
            if (typeof delta === "string" && delta !== "") {
              text += delta;
              await onDelta(delta, { messageId: finalMessageId });
            }
            // 流式的 usage 通常只在最后一帧出现；每帧覆盖式合并，缺的维度保留上一次的值，
            // 不用后来的 undefined 把已经报过的数抹掉。
            const framed = readUsage(chunk.usage);
            usage = {
              total: framed.total ?? usage.total,
              prompt: framed.prompt ?? usage.prompt,
              completion: framed.completion ?? usage.completion,
            };
          }
        }
      }
    } catch (e) {
      if (e instanceof ModelCallError) throw e;
      // 同 `postCompletions`：只取枚举 token，`message` 不读。
      throw new ModelCallError(
        "MODEL_CALL_FAILED",
        `model provider stream transport failure (${classifyTransportError(e)})`,
      );
    }

    return { text, finalMessageId, tokens: usage.total, promptTokens: usage.prompt, completionTokens: usage.completion };
  }
}
