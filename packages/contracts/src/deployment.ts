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
