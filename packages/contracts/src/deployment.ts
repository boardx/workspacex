/**
 * 版次（edition）—— 「这份部署是本机装的，还是线上正式系统」的**判定与差异单源**。
 *
 * ## 为什么必须是契约，而不是各处一个 env 判断
 *
 * 2026-09-22 人类交办：本地版与在线正式系统「功能可能要不一样」，而且界面上要看得出来。
 * 这件事一旦落地，同一个事实会被至少四个地方读到：
 *   · 后端要据它决定**故障纪律**（例：技能溯源投递失败是不是要把整条 run 判失败）
 *   · 后端要据它拒绝或降级某些能力（云端模型、MCP 出网、邮件外发）
 *   · 前端要据它整屏换外观（顶栏、侧栏、配色标识），否则「本地」等于不存在
 *   · 前端要据它诚实列出「本地做不到什么、为什么」，不能让用户点了才发现是死按钮
 * 本仓已**十一次**因「同一事实声明在两处」漂移（见 AGENTS.md）。这一条漂移的代价是
 * 用户以为自己在本地、其实请求出了网，或者反过来在本地界面上点到一个永远不会成功的按钮。
 *
 * ## 与 `identity.ts` 的 `personal-local` 组织是什么关系
 *
 * **两个正交的维度，不要合并**：
 *   · `LOCAL_ORG_KIND`（identity.ts）说的是**这个组织**的隔离承诺——它在云端部署里
 *     同样存在（每个人都有一个个人本地组织，数据不出本机部署）。
 *   · 这里的 `DeploymentEdition` 说的是**这份程序跑在哪**——桌面版整机自带模型与数据库，
 *     还是浏览器连着线上集群。
 * 一个 `local` 版次里的组织当然也可以是普通 `organization`（桌面版 provision 出来的就是），
 * 而一个 `cloud` 版次里也照样有 `personal-local` 组织。把两者混成一个布尔值，会让
 * 「本地版里的普通组织」既拿不到桌面版该有的降级，又被误判成有云端能力。
 */
import { z } from "zod";
import { AgentRunFailureReason } from "./wave2-runtime";

type AgentRunFailureReasonValue = z.infer<typeof AgentRunFailureReason>;

export const DeploymentEdition = z.enum(["cloud", "local"]);
export type DeploymentEditionValue = z.infer<typeof DeploymentEdition>;

/** 环境变量名。**只有这一个名字**——后端读它，打包脚本写它。 */
export const DEPLOYMENT_EDITION_ENV = "WORKSPACEX_EDITION";

/**
 * 解析版次。认不出来（未设、拼错、空串）⇒ `cloud`。
 *
 * ⚠ 默认值的方向是**安全方向**：把云端误判成本地，会让一份线上部署悄悄放宽故障纪律、
 * 悄悄少收审计事实；把本地误判成云端，最坏只是本地版少了几处降级、界面少一块标识——
 * 两者都不好，但只有前者会污染线上账本。
 */
export function parseDeploymentEdition(raw: string | null | undefined): DeploymentEditionValue {
  const parsed = DeploymentEdition.safeParse((raw ?? "").trim());
  return parsed.success ? parsed.data : "cloud";
}

export const DEPLOYMENT_EDITION_LABEL: Record<DeploymentEditionValue, string> = {
  cloud: "在线版",
  local: "本地版",
};

/* ───────────────────────────── 故障纪律差异 ───────────────────────────── */

/**
 * 技能溯源事实（`skill_activity`）投递不成功时怎么办 —— **两个版次两条纪律**。
 *
 * ## 云端：`fail-closed`（逐字不变）
 * 技能溯源账本缺一页，就没人说得清「这次回答用了哪个 skill 的哪个版本」。那是合规问题，
 * 宁可让这次 run 失败也不能静默缺页。判据与反证见
 * `apps/api/tests/agent-runtime/workbench-skill-activity.test.ts`。
 *
 * ## 本地：`best-effort`（2026-09-22 新增）
 * 单人单机，账本只服务这一个人的排障，没有第二方要审计它。而代价是真实的：
 * 用户自己那台机器上的 api.log 里，两条 run 失败**全部**是
 * `skill_activity_delivery_unavailable`——SSE 流在一个干净帧边界上断掉（本地
 * PGlite 串行 + 4B 模型长时间不出字，帧间隔动辄几十秒），图还在跑、答案还在生成，
 * 却因为一条**展示/溯源**事实没送到就把整条 run 判失败，用户等了几分钟拿到一句
 * 「有一次工具调用始终没有返回结果」。
 *
 * 降级**不是静默**：投递不成功时账本要留一条明确的缺页标记（见
 * `SKILL_ACTIVITY_GAP_NOTE`），排障时「没用 skill」与「用了但没记下来」必须分得开。
 */
export const SkillActivityDeliveryDiscipline = z.enum(["fail-closed", "best-effort"]);
export type SkillActivityDeliveryDisciplineValue = z.infer<typeof SkillActivityDeliveryDiscipline>;

export function skillActivityDeliveryDiscipline(
  edition: DeploymentEditionValue,
): SkillActivityDeliveryDisciplineValue {
  return edition === "local" ? "best-effort" : "fail-closed";
}

/** 降级时写进账本的那句话。系统自己说的事实，不冒充模型或工具的输出。 */
export const SKILL_ACTIVITY_GAP_NOTE =
  "本轮的技能溯源事实没有全部收到（本地版降级：不因此判本次执行失败）。已执行的工具与产出不受影响，但这一轮的技能使用记录可能不完整。";

/* ──────────────────────── 失败之后该做什么（按版次） ──────────────────────── */

/**
 * 一次失败之后**这台机器上**能做的下一步 —— 本地版专用的一句可执行建议。
 *
 * ## 为什么必须分版次
 *
 * `apps/web/lib/agent-run.ts` 里那套失败文案是照**云端部署**写的：
 * 「请联系管理员」「所选模型服务尚未配置，请联系管理员」「请把这次的任务编号报给管理员」。
 * 本地版是**单人单机**——没有第二个人，用户自己就是管理员。让他去联系一个不存在的人，
 * 等于告诉他「没救了」，而真实情况往往是「重发一次就好」或者「日志在这个路径下」。
 *
 * ⚠ key 集合与 `wave2-runtime.ts` 的 `AgentRunFailureReason` 是**同一件事**：
 * 新增枚举值时 TypeScript 会在这里报缺 key，不会静默漏一句建议。
 * ⚠ 这里只**追加**一句本地建议，不改任何一句既有文案——「哪一类终态」「什么成因」
 * 仍然由 `agent-run.ts` 那两张表回答，本表回答的是第三个问题：「那我现在做什么」。
 */
export const LOCAL_FAILURE_NEXT_STEP: Record<AgentRunFailureReasonValue, string> = {
  provider_returned_empty: "本机的小模型偶尔会空转一轮。原样重发一次通常就好；连续两次都空，把问题说得更具体一点再试。",
  provider_rejected: "这是本机那个智能体服务自己报的错。重发一次；仍然失败就看 logs/deep-agent.log 的最后几十行。",
  provider_timeout: "本机模型比云端慢得多，复杂任务容易超预算。把任务拆小（比如先只要画布的一个分区），或者稍后重试。",
  provider_transport_failed: "本机的服务之间断了一下——刚启动时最常见。等十几秒再重发。",
  runtime_unavailable: "本地运行时没起全。退出应用再打开一次；反复如此就看 logs/api.log 与 logs/deep-agent.log。",
  tool_call_unresolved: "有一次工具调用没回来。原样重发；如果每次都停在同一个工具上，把它涉及的输入（文件/网址）换一个再试。",
  executor_defect: "这是程序自己的缺陷，不是你的操作问题。本机没有管理员——请把这次的任务编号和 logs/api.log 一起反馈给我们。",
  run_reaped: "执行它的进程中途没了（常见于应用被强制退出或睡眠唤醒）。重发即可，这条不会自己恢复。",
  unknown: "没能归类出原因。原样重发一次；如果稳定复现，请把任务编号和 logs/api.log 一起反馈给我们。",
};

/** 本版次在失败之后给不给这句额外建议。在线版不给：那套文案本来就是为它写的。 */
export function failureNextStep(
  edition: DeploymentEditionValue,
  reason: keyof typeof LOCAL_FAILURE_NEXT_STEP | null | undefined,
): string | null {
  if (edition !== "local" || reason === null || reason === undefined) return null;
  return LOCAL_FAILURE_NEXT_STEP[reason] ?? null;
}

/* ─────────────────────── 长时间不返回的工具调用 ─────────────────────── */

/**
 * 一次工具调用**开了多久还没回来**就该在界面上说一句 —— `null` = 这个版次不说。
 *
 * ## 为什么本地版必须说，而在线版这一轮不说
 *
 * 本地版一次画布请求的实测是**分钟级**（4B 模型 + 单模型槽 + PGlite 串行），而界面上
 * 只有一个转圈的图标：用户看不出「还在跑」和「卡死了」的区别。人类 2026-09-22 给的那张
 * 截图就是这一幕的终点——等了几分钟，最后得到一句「有一次工具调用始终没有返回结果」。
 * 在线版这一轮**不开**，理由是纪律而非偏好：它的账本内容不该因为本地版的一个体验改动
 * 而多出事件（`tool_progress` 虽然是有损展示通道，但「云端逐字节不变」是本次改动的前提）。
 *
 * ⚠ 它**只是展示**：不改任何终态判定，不是超时，也不取消那次调用。
 * 消费端不许拿它推断工具成功与否——那是 `tool_end.ok` 唯一负责的事。
 */
export function toolStallNoticeMs(edition: DeploymentEditionValue): number | null {
  return edition === "local" ? 60_000 : null;
}

/** 那句话。占位符由调用方替换成真实分钟数；总长受 `ToolProgressFields.message` 的 200 字限制。 */
export function toolStallNotice(toolName: string, elapsedMs: number): string {
  const minutes = Math.max(1, Math.round(elapsedMs / 60_000));
  return `「${toolName}」已经执行 ${String(minutes)} 分钟，仍在等它的结果（本地模型较慢，这是正常范围内的等待，不是卡死）。`;
}

/* ──────────────────────────── 切到在线正式系统 ──────────────────────────── */

/**
 * 在线正式系统的地址。**没有默认值**——本仓里不存在一个已知的生产域名，编一个出来
 * 就是在界面上放一个会把用户送去错误地方的按钮（本仓「不猜」纪律）。没配 ⇒ 界面如实说
 * 这份安装包还没配在线地址，并给出仍然可用的那条路（把成果导出到正式组织）。
 */
export const DEPLOYMENT_CLOUD_URL_ENV = "WORKSPACEX_CLOUD_URL";

/**
 * 解析在线地址，**拒绝**一切不能安全交给浏览器打开的东西：
 *   · 只认 `http:` / `https:`（`javascript:` / `data:` / `file:` 一律拒）
 *   · 不认带用户名密码的 URL（凭据不该出现在一个会被展示、会被点击的地址里）
 * 解析不出来 ⇒ `null`，等价于「没配」。绝不返回一个「差不多能用」的字符串。
 */
export function parseCloudUrl(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? "").trim();
  if (trimmed === "") return null;
  let url: URL;
  try { url = new URL(trimmed); } catch { return null; }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username !== "" || url.password !== "") return null;
  return url.toString();
}

/**
 * 从本地版切到在线正式系统时，用户必须先知道的事 —— **结构化**，不是一段散文。
 *
 * 为什么不写成一段话：界面要逐条列（每条一个 `data-testid`，反证才打得准），而「数据
 * 不会跟着走」这一条是**不可省**的——本地版的库、模型、产物都在这台机器上，打开在线
 * 系统不等于搬家。省掉它，用户会以为切过去就能看到自己的东西。
 */
export const CLOUD_SWITCH_NOTES = [
  {
    id: "data-stays",
    /*
     * ⚠ 这句话曾经写成「要带过去，用『导出到正式组织』」。那是**不真实的**：
     * `/admin/local` 那一屏的三步导出流程用的是契约生成的样例响应与写死的演示成果，
     * 一次网络调用都不发（见 `apps/web/components/admin/local-export-panel.tsx`）。
     * 在真实导出通道实现之前，这里只说真话：自己下载、到那边上传。
     */
    statement: "本地的对话、画布与文件不会跟着走：它们在这台电脑上，在线系统看不到。真正的自动搬运还没实现——现在要带走，请把产出下载到本地，再到在线系统里上传。",
  },
  {
    id: "separate-account",
    statement: "在线正式系统用的是你的在线账号，与本地版这个只存在于本机的账号不是同一个。",
  },
  {
    id: "network-required",
    statement: "在线系统需要联网，请求会离开这台电脑；本地版的「数据不出本机」承诺在那里不适用。",
  },
  {
    id: "local-stays-running",
    statement: "本地版不会被关掉：在线系统在浏览器里打开，这个窗口照旧是本地的。",
  },
] as const;

/* ───────────────────────────── 能力差异矩阵 ───────────────────────────── */

/** 一项能力在某个版次里的状态。 */
export const CapabilityAvailability = z.enum(["full", "limited", "absent"]);
export type CapabilityAvailabilityValue = z.infer<typeof CapabilityAvailability>;

export const CAPABILITY_AVAILABILITY_LABEL: Record<CapabilityAvailabilityValue, string> = {
  full: "可用",
  limited: "有限",
  absent: "不可用",
};

/**
 * 两个版次的**能力差异表** —— 界面按它渲染，后端按它给拒绝理由。
 *
 * ## 收录标准（不收的比收的重要）
 * 只收**用户能感知到差别**的条目，且差别是**结构性**的（装在哪决定了它，不是配置项）。
 * 「云端更快」不收——那是同一能力的性能差异，属于评测，不属于能力表。
 *
 * ⚠ `why` 写的是**原因**，不是安慰。用户在界面上读到它就该知道「要它就得去在线版」
 * 还是「这台机器上本来就没有这条路」。
 */
export const EDITION_CAPABILITIES = [
  {
    id: "cloud-models",
    capability: "云端大模型（更强的推理与长上下文）",
    cloud: "full",
    local: "absent",
    why: "本地版只调用随包的本机模型，请求不出网——这是本地版的产品承诺，不是开关。",
  },
  {
    id: "local-models",
    capability: "随包本机模型（离线可用、数据不出网）",
    cloud: "limited",
    local: "full",
    why: "在线版可以接自托管端点，但不随包模型权重；断网后在线版不能工作。",
  },
  {
    id: "mcp-egress",
    capability: "MCP 外部工具（连第三方系统）",
    cloud: "full",
    local: "absent",
    why: "MCP 调用必然出网，与本地版「数据不出本机」相冲突。",
  },
  {
    id: "subagents",
    capability: "子代理与深度研究（多智能体分工）",
    cloud: "full",
    local: "absent",
    why: "一台机器上的小模型跑多智能体只会更慢更差，本地版把这些工具从模型请求里去掉了。",
  },
  {
    id: "collaboration",
    capability: "多人协作：成员邀请、共享、跨组织检索",
    cloud: "full",
    local: "absent",
    why: "本地版是单人单机部署，没有第二个账号，也没有共享存储。",
  },
  {
    id: "outbound-notifications",
    capability: "邮件与外发通知",
    cloud: "full",
    local: "absent",
    why: "本地版不配发信通道，通知只留在本机收件箱里。",
  },
  {
    id: "image-generation",
    capability: "AI 出图（文生图）",
    cloud: "full",
    local: "absent",
    why: "出图要调云端出图服务（百炼 / OpenAI），本地版既不出网也不随包出图模型权重。",
  },
  {
    id: "error-log-ai-summary",
    capability: "系统异常的 AI 研判摘要",
    cloud: "full",
    local: "absent",
    why: "它是给运维团队看的元任务，而本机只有你一个人；而且它每条异常都要占用同一个本地模型，异常风暴时会把你正在等的回答挤到后面。",
  },
  {
    id: "audit-provenance",
    capability: "完整审计与技能溯源账本",
    cloud: "full",
    local: "limited",
    why: "本地版在溯源事实投递不成功时会明确标记缺页并继续执行，而不是把整次执行判失败。",
  },
  {
    id: "export-to-organization",
    capability: "把本地成果导出到正式组织",
    cloud: "limited",
    local: "full",
    why: "导出豁口是本地→正式的单向通道；在线版只作为接收方。",
  },
  {
    id: "offline",
    capability: "断网可用",
    cloud: "absent",
    local: "full",
    why: "本地版的模型、数据库与技能沙箱都在本机，断网只影响联网工具。",
  },
] as const satisfies ReadonlyArray<{
  readonly id: string;
  readonly capability: string;
  readonly cloud: CapabilityAvailabilityValue;
  readonly local: CapabilityAvailabilityValue;
  readonly why: string;
}>;

export type EditionCapabilityId = (typeof EDITION_CAPABILITIES)[number]["id"];

/** 这个版次里该能力的状态。未收录的 id 返回 `undefined`——不猜。 */
export function capabilityAvailability(
  edition: DeploymentEditionValue,
  id: string,
): CapabilityAvailabilityValue | undefined {
  const row = EDITION_CAPABILITIES.find((c) => c.id === id);
  return row === undefined ? undefined : row[edition];
}

/** 本版次相比另一个版次**少掉**的能力（界面「本地版做不到什么」那一段的唯一来源）。 */
export function capabilitiesMissingIn(
  edition: DeploymentEditionValue,
): ReadonlyArray<(typeof EDITION_CAPABILITIES)[number]> {
  const other: DeploymentEditionValue = edition === "local" ? "cloud" : "local";
  const rank: Record<CapabilityAvailabilityValue, number> = { absent: 0, limited: 1, full: 2 };
  return EDITION_CAPABILITIES.filter((c) => rank[c[edition]] < rank[c[other]]);
}
