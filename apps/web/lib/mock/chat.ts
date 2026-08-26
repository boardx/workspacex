/**
 * 对话主屏的 mock 数据与纯函数 —— **刻意不带 `"use client"`**。
 *
 * 原因同 `lib/ui-state.ts`：标 `"use client"` 的模块其全部导出都会变成客户端引用，
 * 服务端组件（`app/chat/page.tsx`）import 进来的纯函数会变成代理、调用即报错。
 * 所以「类型 + 数据 + 派生纯函数」放这里，交互组件放 `components/chat/*`。
 *
 * 数据密度对齐 `phases/phase-01-run-a-project/ui-preview/PROTOTYPE-DIGEST.md` 第二节
 * 的实测抽取：六个 agent 三态、线程按 今天/本周/周三 分组、消息流四类卡。
 *
 * ⚠ 批准卡（ApprovalRequest）是**产品信任核心**，其模型 / 预算 / 数据范围三项
 *   必须**数据驱动**（裁决 D-07：模型与 MCP 管理进 phase-1）。
 *   「含机密，仅本地模型」由 `dataScopeConstraint()` 从数据推出，不是写死文案。
 *
 * ⚠ **本文件与 `@repo/contracts/chat` 的关系**（2026-07-31 逐条比对后收敛）：
 *   · 取值完全相同的（`ToolCallStatus` / `CitationAnchorKind`）⇒ 已改为 `z.infer` 派生。
 *   · 结构不同的渲染视图（线程卡 / 工具调用行 / 右栏标签）⇒ 加 `View` 后缀分离。
 *   · 取值也不一致的（在场态 / 可见性 / 徽标 / 批准态）⇒ 加 `View` 后缀 **＋ 登记进
 *     `@/lib/contract-divergences`**，哪边对是**签核动作**，不由本文件选边。
 */
import type { z } from "zod";
import * as C from "@repo/contracts/chat";

/* ─────────────────────────── AI 团队面板（UC-4.2 / UC-8.2 R3 一） ─────────────────────────── */

/**
 * agent 在场态（展示层）。⚠ 与契约 `chat.AgentPresence` **同名不同义且取值不一致**
 * ⇒ 已改名分离，见 `CONTRACT_DIVERGENCES.D04`（那里也记了契约侧 `AgentPresence`
 * 被声明两次这件事）。**不要就地合并**——合并会让「跑批中」这个在场数分母消失。
 */
export type AgentPresenceView = "present" | "batching" | "idle";
export const AGENT_PRESENCE_LABEL: Record<AgentPresenceView, string> = {
  present: "在场",
  batching: "跑批中",
  idle: "空闲",
};
/** 在场态徽标色调：跑批中=ai（正在工作）、空闲=neutral、在场=primary */
export const AGENT_PRESENCE_TONE: Record<AgentPresenceView, "primary" | "ai" | "neutral"> = {
  present: "primary",
  batching: "ai",
  idle: "neutral",
};

export interface TeamAgent {
  id: string;
  initials: string;
  name: string;
  role: string;
  /** 职责一句话 —— UC-8.2 R7：不得只显示名称 */
  duty: string;
  presence: AgentPresenceView;
}

/** 六个 agent 全给（PROTOTYPE-DIGEST 第二节实测表）*/
export const TEAM_AGENTS: TeamAgent[] = [
  { id: "av", initials: "AV", name: "Ava", role: "战略分析师", duty: "拆问题、标致命假设、给结论先行", presence: "present" },
  { id: "at", initials: "AT", name: "Atlas", role: "流程诊断", duty: "把业务流拆成任务，标可自动化环节", presence: "present" },
  { id: "sc", initials: "SC", name: "Scout", role: "同行情报", duty: "找同行 AI 落地案例与一手材料，带引用", presence: "present" },
  { id: "lg", initials: "LG", name: "Ledger", role: "收益测算", duty: "算人天节省、单位成本与回本周期", presence: "batching" },
  { id: "wd", initials: "WD", name: "Warden", role: "风险与合规", duty: "数据出域、隐私、模型使用红线", presence: "present" },
  { id: "ec", initials: "EC", name: "Echo", role: "访谈综合", duty: "转录一线访谈、抽引述、合并同类观点", presence: "idle" },
];

/** 编制数（侧栏「AI 团队 · N」）≠ 在场数（线程头「团队 N」）—— UC-4.2 R6 两个口径必须分别标注 */
export const TEAM_ROSTER_COUNT = TEAM_AGENTS.length; // 6，编制数
// 在场数 = 仅「在场」态（对齐原型「团队 4」：跑批中/空闲不计入在场数，与编制数 6 分离）
export const TEAM_PRESENT_COUNT = TEAM_AGENTS.filter((a) => a.presence === "present").length;

/* ─────────────────────────── 线程列表（UC-8.1 R3）─────────────────────────── */

export type ThreadBadgeKind = "transcribing" | "review" | "archived" | "agents" | "time";
/**
 * 线程卡（展示层）。⚠ 与契约 `chat.ThreadCard` **同名不同义**：
 * 契约那份是线上载荷 `{id,title,subtitle,badges[],status,artifactCount,lastActivityAt,visibilityScope}`，
 * 这份是**渲染后的列表行**（单个已选好的徽标 + 合成的 meta 串 + 选中态）。
 * 结构不同、取值不冲突 ⇒ 改名分离即可，无需人类裁决。
 */
export interface ThreadCardView {
  id: string;
  title: string;
  /** 状态徽标 —— UC-8.1 R7：一等取值，不得自造 */
  badge?: { kind: ThreadBadgeKind; label: string };
  /** 参与摘要 / 最后活动 */
  meta?: string;
  active?: boolean;
}
export interface ThreadGroup {
  key: string;
  /** 按时间分组，组标题常驻（UC-8.1 R8）*/
  label: string;
  threads: ThreadCardView[];
}

export const THREAD_GROUPS: ThreadGroup[] = [
  {
    key: "today",
    label: "今天",
    threads: [
      { id: "eu-storage", title: "欧洲储能进入策略 · 假设梳理", badge: { kind: "transcribing", label: "转录中" }, meta: "4 个 agent", active: true },
      { id: "de-tariff", title: "德国工商储电价机制核查", badge: { kind: "review", label: "3 条待复核" }, meta: "Scout · 14:02" },
    ],
  },
  {
    key: "week",
    label: "本周",
    threads: [
      { id: "itv-07", title: "客户访谈 07 · 采购总监", badge: { kind: "archived", label: "已归档" }, meta: "Echo · 11:20" },
      { id: "cn-supply", title: "国内供应链弹性评估", badge: { kind: "agents", label: "2 个 agent" }, meta: "Atlas · 周二" },
    ],
  },
  {
    key: "wed",
    label: "周三",
    threads: [
      { id: "competitor", title: "竞品拆解：Sungrow / BYD 欧洲布局", meta: "周三" },
    ],
  },
];

/* ─────────────────────────── 线程头部 ─────────────────────────── */

export const ACTIVE_THREAD = {
  id: "eu-storage",
  title: "欧洲储能进入策略 · 假设梳理",
  subtitle: "远洋新能源 / 欧洲市场进入 · 第 2 周 · 转录中",
  rosterCount: TEAM_ROSTER_COUNT, // 编制 6
  presentCount: TEAM_PRESENT_COUNT, // 在场 4
};

/* ─────────────────────────── 引用（UC-8.2 R7 引用层，三段缺一不可）─────────────────────────── */

/** ⚠ 与契约 `chat.CitationAnchorKind` **逐值相同** ⇒ 从契约派生，不留第二份（ADR-020）。 */
export type CitationAnchorKind = z.infer<typeof C.CitationAnchorKind>;
/**
 * 契约里的 `Citation` 是**线上引用**（`{segmentId, artifactVersionId}`）；
 * 这里是**渲染后的展示视图**（带序号、出处全称、已解析的锚点）。两者不同层，故名字上分开。
 */
export interface CitationView {
  index: number;
  /** 出处全称 */
  sourceFullName: string;
  /** 页码 / 转录时间段 / messageId —— **不能省**，无锚点视为不合格 */
  anchor: string;
  anchorKind: CitationAnchorKind;
}

/* ─────────────────────────── 工具调用（UC-8.2 R7 工具调用层）─────────────────────────── */

/** ⚠ 与契约 `chat.ToolCallStatus` **逐值相同** ⇒ 从契约派生，不留第二份（ADR-020）。 */
export type ToolCallStatus = z.infer<typeof C.ToolCallStatus>;
export const TOOL_CALL_STATUS_LABEL: Record<ToolCallStatus, string> = {
  done: "完成",
  reuse: "复用",
  running: "运行中",
  failed: "失败",
};
/**
 * 一次工具调用（展示层）。⚠ 与契约 `chat.ToolCall` **同名不同义**：
 * 契约那份是审计载荷（十个字段，含 `callerAgentId` / `pipelineVersion` / `provenanceEventId`），
 * 这份是**折叠面板里渲染的一行**——签名与结果都已拼成人读串。
 * 结构不同、取值不冲突（`status` 已从契约派生）⇒ 改名分离即可。
 */
export interface ToolCallView {
  /** 函数签名 + 实参 */
  signature: string;
  /** 命中数 / 复用标记 / 运行态短语 */
  result: string;
  status: ToolCallStatus;
}
export interface ToolCallLog {
  /** 汇总：调用数 */
  count: number;
  /** 汇总：读取条数 */
  readItems: number;
  /** 汇总：token 读取量 */
  tokens: string;
  calls: ToolCallView[];
}

/* ─────────────────────────── 消息头角标（UC-8.2 R7 状态可见性）─────────────────────────── */

/**
 * 消息头角标（展示层）。⚠ 与契约 `chat.MessageBadge` **同名不同义且取值不一致**
 * ⇒ 已改名分离，见 `CONTRACT_DIVERGENCES.D06`。
 * 契约是裸枚举 `["degraded","review-pending"]`；这里是带载荷的可辨识联合，
 * 且待复核那一档的码是 `review` 不是 `review-pending`。载荷（`model` / `count`）
 * 在契约里没有字段承载——**由谁提供也是待裁项**，不在此处发明。
 */
export type MessageBadgeView =
  | { kind: "degraded"; model: string } // 降级运行 · sonnet
  | { kind: "review"; count: number }; // 待复核 3

/* ─────────────────────────── 批准卡（信任核心，UC-8.2 R3 步骤 6 / R7）─────────────────────────── */

export type ModelHosting = "cloud" | "local";
export interface ApprovalModel {
  id: string;
  /** 展示名（云端直接名字；本地带「本地」前缀）*/
  label: string;
  hosting: ModelHosting;
  /** registry 中的模型版本（provenance 需要）*/
  version: string;
}
export interface ApprovalBudget {
  tokens: number;
  tokensDisplay: string;
  /** ISO 货币码；界面按 currencySymbol 折算 */
  currency: string;
  estCost: number;
  costDisplay: string;
  /** 供数来源 —— 必须来自 model registry，不是硬编码（UC-8.2 AC7 / D-07）*/
  registrySource: string;
}
export interface ApprovalDataItem {
  id: string;
  label: string;
  /** 机密标记 —— 「仅本地模型」由此推导 */
  confidential: boolean;
}
/**
 * 批准卡状态（展示层）。⚠ 与契约 `chat.ApprovalStatus` **同名、取值是其真子集**
 * （少 `reparamed`）⇒ 已改名分离，见 `CONTRACT_DIVERGENCES.D07`。
 * 不直接派生的原因：契约把「改参后批准」当一等出口，视图这边没有对应卡片态；
 * 直接 `z.infer` 会静默多出一个界面渲染不了的取值，那是假的一致。
 */
export type ApprovalStatusView = "paused" | "expired" | "approved" | "declined";

export interface ApprovalRequest {
  id: string;
  status: ApprovalStatusView;
  title: string;
  /** 调用链（谁调的谁）—— agent 互调深度上限 2（O-36）*/
  callChain: string[];
  /** 模型集：数据驱动，可含云端 + 本地（含机密的数据只路由到本地模型）*/
  models: ApprovalModel[];
  budget: ApprovalBudget;
  /** 要读的数据及其密级 */
  dataScope: ApprovalDataItem[];
  /** 转后台任务的预计回归分钟数 */
  etaMinutes: number;
  /** 过期态的超时口径（现场 5 分钟 / 非现场 24 小时，O-36）*/
  timeoutHint?: string;
}

export const CURRENCY_SYMBOL: Record<string, string> = { CNY: "￥", USD: "$", EUR: "€" };

/* ── 批准卡派生纯函数（把「文案」换成「从数据推导」）────────────────────────── */

/** 数据范围里是否含机密 */
export function hasConfidential(scope: ApprovalDataItem[]): boolean {
  return scope.some((d) => d.confidential);
}

/**
 * 从数据范围推导模型约束。
 *
 * ⚠ **裁决 D-U1（2026-07-28）：全程本地，不分流。**
 * 语义是「本轮上下文**含任何**机密条目 ⇒ **整轮所有**模型调用走本地，
 * 云端模型在本轮**不可用**」——不是「机密走本地、云端承接非机密部分」。
 *
 * 为什么不分流：分流的安全性取决于**片段级机密判定**的准确率，
 * 而那是个没有人能保证 100% 的分类问题，一次误判的代价是不可逆的泄漏。
 * 代价（整轮降级到本地小模型）用「把机密材料单独开一轮」规避，
 * 且那个规避动作是用户可见可控的。
 *
 * 这条约束**由数据推出**，服务端 gateway 按同一规则拦截，界面只呈现判定结果。
 */
export function dataScopeConstraint(scope: ApprovalDataItem[]): {
  localModelOnly: boolean;
  note: string;
} {
  if (hasConfidential(scope)) {
    return { localModelOnly: true, note: "含机密，本轮全程本地模型" };
  }
  return { localModelOnly: false, note: "公开数据，可用云端模型" };
}

/** 「项目库 ＋ 电价曲线 · 含机密，仅本地模型」—— 整行由数据拼出 */
export function dataScopeLine(scope: ApprovalDataItem[]): string {
  const labels = scope.map((d) => d.label).join(" ＋ ");
  return `${labels} · ${dataScopeConstraint(scope).note}`;
}

/** 「gpt-5.2 ＋ 本地 qwen3-32b」 */
export function modelLine(models: ApprovalModel[]): string {
  return models.map((m) => m.label).join(" ＋ ");
}

/** 「800k（约 ￥9.6）」 */
export function budgetLine(b: ApprovalBudget): string {
  const symbol = CURRENCY_SYMBOL[b.currency] ?? b.currency;
  return `${b.tokensDisplay}（约 ${symbol}${b.estCost}）`;
}

/**
 * 策略校验（裁决 D-U1：全程本地）。
 *
 * 两种违规，都会被服务端 gateway 拒绝（UC-8.2 V3）：
 *   ① 含机密却**混入了云端模型** —— 这是 D-U1 的核心，旧实现允许并存，现在不允许；
 *   ② 含机密却**一个本地模型都没有** —— 无从承接。
 * 返回 null 表示当前模型集合合规。
 */
export function modelPolicyViolation(models: ApprovalModel[], dataScope: ApprovalDataItem[]): string | null {
  const { localModelOnly } = dataScopeConstraint(dataScope);
  if (!localModelOnly) return null;
  const cloud = models.filter((m) => m.hosting === "cloud");
  if (cloud.length > 0) {
    return `本轮含机密数据，按「全程本地」规则不得混入云端模型：${cloud
      .map((m) => m.label)
      .join("、")} 需移除，否则将被 gateway 拒绝`;
  }
  if (!models.some((m) => m.hosting === "local")) {
    return "本轮含机密数据，但没有任何本地模型承接，将被 gateway 拒绝";
  }
  return null;
}

/** 某个模型在当前数据范围下是否可选（界面用来置灰云端模型 chip） */
export function isModelSelectable(model: ApprovalModel, dataScope: ApprovalDataItem[]): {
  ok: boolean;
  reason?: string;
} {
  if (dataScopeConstraint(dataScope).localModelOnly && model.hosting === "cloud") {
    return { ok: false, reason: "本轮含机密数据 · 全程本地，云端模型不可用（裁决 D-U1）" };
  }
  return { ok: true };
}

/* ─────────────────────────── 消息流（四类卡 + 进度/转录）─────────────────────────── */

export interface ArtifactCard {
  artType: string; // 「假设树」
  name: string; // 「进入模式」
  structure: string; // 「flowchart LR · 6 节点」
  dataChain: string; // 「```mermaid → DiagramModel → fabric」
  annotation: string; // 「3 个致命假设已标红」
  actions: string[]; // 「派给 Scout 验证」「加入报告」
}

export type ChatMessage =
  | { id: string; kind: "human"; author: string; time: string; initials: string; text: string }
  | {
      id: string;
      kind: "ai";
      agentId: string;
      agentName: string;
      agentRole: string;
      initials: string;
      skill?: string;
      thinking?: string; // 「思考了 8.2 秒 · 4 步」
      time: string;
      badges: MessageBadgeView[];
      text: string;
      tools?: ToolCallLog;
      citations?: CitationView[];
    }
  | { id: string; kind: "artifact"; artifact: ArtifactCard }
  | { id: string; kind: "approval"; request: ApprovalRequest }
  | { id: string; kind: "progress"; agent: string; task: string; done: number; total: number }
  | { id: string; kind: "transcript"; elapsed: string; line: string };

export const CHAT_MESSAGES: ChatMessage[] = [
  {
    id: "m1",
    kind: "human",
    author: "项目经理",
    time: "14:31",
    initials: "周",
    text: "欧洲储能这块，我们下周要跟客户董事会过一版进入策略。先把致命假设梳出来——哪些一旦不成立，整个路径就得推倒重来？",
  },
  {
    id: "m2",
    kind: "ai",
    agentId: "av",
    agentName: "Ava",
    agentRole: "战略分析师",
    initials: "AV",
    skill: "MECE 假设拆解",
    thinking: "思考了 8.2 秒 · 4 步",
    time: "14:32",
    badges: [{ kind: "review", count: 3 }],
    text: "我把进入策略拆成 4 组假设，其中 3 条是致命假设（不成立即推翻路径）：①并网许可周期可控（＜18 个月）；②本地 EPC 产能可锁定；③电价套利窗口在补贴退坡后仍为正。下面是依据。",
    tools: {
      count: 3,
      readItems: 64,
      tokens: "12.4k",
      calls: [
        { signature: 'graph.search(project:"远洋", type:["假设","证据"])', result: "64 命中", status: "done" },
        { signature: 'brain.recall("资质尽调清单")', result: "复用 1 份", status: "reuse" },
        { signature: 'mcp:行业数据库.query_market(region:"DE")', result: "运行中", status: "running" },
      ],
    },
    citations: [
      { index: 1, sourceFullName: "Bundesnetzagentur《Netzanschluss 年报 2025》", anchor: "第 42 页", anchorKind: "page" },
      { index: 2, sourceFullName: "客户访谈 07 · 采购总监", anchor: "Echo 转录，14:12 段", anchorKind: "transcript" },
    ],
  },
  {
    id: "m3",
    kind: "artifact",
    artifact: {
      artType: "假设树",
      name: "进入模式",
      structure: "flowchart LR · 6 节点",
      dataChain: "```mermaid → DiagramModel → fabric",
      annotation: "3 个致命假设已标红",
      actions: ["派给 Scout 验证", "加入报告"],
    },
  },
  {
    id: "m4",
    kind: "progress",
    agent: "Ava",
    task: "正在重排致命假设优先级",
    done: 2,
    total: 4,
  },
  {
    id: "m5",
    kind: "ai",
    agentId: "sc",
    agentName: "Scout",
    agentRole: "同行情报",
    initials: "SC",
    skill: "同行案例检索",
    thinking: "思考了 5.4 秒 · 3 步",
    time: "14:34",
    badges: [{ kind: "degraded", model: "sonnet" }],
    text: "补充一条：并网周期在巴伐利亚州近 12 个月出现明显缩短（新数字化审批），这会松动假设①。已附来源。",
    tools: {
      count: 2,
      readItems: 18,
      tokens: "4.1k",
      calls: [
        { signature: 'mcp:行业数据库.query_grid(region:"DE-BY")', result: "12 命中", status: "done" },
        { signature: 'graph.search(project:"远洋", type:["证据"])', result: "调用失败：MCP 授权超时", status: "failed" },
      ],
    },
    citations: [
      { index: 3, sourceFullName: "Bayernwerk Netz《并网时效季报 2025Q1》", anchor: "第 7 页", anchorKind: "page" },
    ],
  },
  {
    id: "m6",
    kind: "approval",
    request: {
      id: "apr-ledger-1",
      status: "paused",
      title: "Ledger 想执行一个动作，等你批准",
      callChain: ["Ava", "Ledger"],
      models: [
        { id: "gpt-5.2", label: "gpt-5.2", hosting: "cloud", version: "2025-06" },
        { id: "qwen3-32b", label: "本地 qwen3-32b", hosting: "local", version: "self-hosted@1.4" },
      ],
      budget: {
        tokens: 800_000,
        tokensDisplay: "800k",
        currency: "CNY",
        estCost: 9.6,
        costDisplay: "约 ￥9.6",
        registrySource: "model-registry@v12",
      },
      dataScope: [
        { id: "project-lib", label: "项目库", confidential: true },
        { id: "power-curve", label: "电价曲线", confidential: true },
      ],
      etaMinutes: 6,
      timeoutHint: "现场 5 分钟 / 非现场 24 小时",
    },
  },
  {
    id: "m7",
    kind: "transcript",
    elapsed: "28:14",
    line: "周宁：客户董事会给的窗口是十八个月，超过就等于错过这一轮补贴。",
  },
  {
    id: "m8",
    kind: "approval",
    request: {
      id: "apr-scout-expired",
      status: "expired",
      title: "Scout 想调用外部行业数据库，等你批准",
      callChain: ["Scout"],
      models: [{ id: "gpt-5.2", label: "gpt-5.2", hosting: "cloud", version: "2025-06" }],
      budget: {
        tokens: 120_000,
        tokensDisplay: "120k",
        currency: "CNY",
        estCost: 1.4,
        costDisplay: "约 ￥1.4",
        registrySource: "model-registry@v12",
      },
      dataScope: [{ id: "public-market", label: "公开市场数据", confidential: false }],
      etaMinutes: 3,
      timeoutHint: "现场 5 分钟 / 非现场 24 小时",
    },
  },
];

/* ─────────────────────────── 改派建议条（UC-4.2 R3 步骤 9 / UC-8.2 R3 步骤 11）─────────────────────────── */

export interface ReassignSuggestion {
  targetAgent: string;
  /** 具体授权名 —— 不得只说「更合适」（UC-4.2 R7 / V11 reason 非空）*/
  reason: string;
  detail: string;
}
export const REASSIGN_SUGGESTION: ReassignSuggestion = {
  targetAgent: "Scout",
  reason: "有行业数据库授权",
  detail: "这条更适合 Scout：它有行业数据库授权，改派后本轮由它回答",
};

/* ─────────────────────────── 输入区状态四段（UC-8.2 R3 步骤 10）─────────────────────────── */

export const COMPOSER_STATUS = {
  agents: "Ava ＋3",
  skill: "skill：假设拆解",
  context: "已引用 3 项上下文",
  output: "输出到「假设树」",
};

/* ─────────────────────────── 右栏转录（UC-8.2 R3 步骤 13）─────────────────────────── */
/* ⚠ UX-9 Line D1：右栏五标签的展示层 mock（`RightTabView` / `RIGHT_TABS` /
 * `RIGHT_TABS_EMPTY` / `TRANSCRIPT_SESSION`）随 `chat-right-panel.tsx` 整体删除——
 * 无后端支撑的假 UI 不留。`TRANSCRIPT_ENTRIES` 仍被 #462 台账里路由走不到的
 * `message-stream.tsx` 引用，随那条待裁链一起处置。 */

export interface TranscriptEntry {
  id: string;
  speaker: string;
  time: string;
  text: string;
  /** 被 Ava 标记为决策点的行带「看洞察」*/
  decisionPoint?: boolean;
  /** 正在识别的行 */
  identifying?: boolean;
}
export const TRANSCRIPT_ENTRIES: TranscriptEntry[] = [
  { id: "t1", speaker: "周宁", time: "27:41", text: "客户董事会给的窗口是十八个月，超过就等于错过这一轮补贴。", decisionPoint: true },
  { id: "t2", speaker: "林可", time: "27:58", text: "那假设①「并网许可周期可控」就是第一优先级，先让 Scout 去核德国各州的实测周期。" },
  { id: "t3", speaker: "周宁", time: "28:06", text: "EPC 产能这块我担心，去年那家承诺的产能最后只兑现了六成。" },
  { id: "t4", speaker: "Ledger", time: "28:11", text: "我这边在跑三路径的现金流对比，含补贴退坡后的敏感性。", identifying: true },
];

/* ═══════════════════════════════════════════════════════════════════════════
 * UC-8.3 对话产出落地 —— 三模式绑定 / 出处回链 / 未挂来源标灰 / 产物标签徽标
 *
 * ⚠ 机制底座在 `00-core/uc-0-1`（D-38 / D-30），本模块只做**对话侧入口与门控接线**。
 *   三模式的语义、快照不可变、引用资格门控**不在此另建**——这里只是它的展示投影。
 *   凡界面上暗示「对话另有一套产出机制」的地方，README 都标了待裁决。
 * ═══════════════════════════════════════════════════════════════════════════ */

/** 三绑定模式（UC-8.3 R3 步骤 3 表；取值承接 uc-0-1，不得增删）*/
export type BindMode = "draft" | "live" | "snapshot";
export interface BindModeSpec {
  mode: BindMode;
  label: string;
  /** 徽标文案（右栏产物列表用）—— UC-8.3 R8：三态明确区分 */
  badge: string;
  badgeTone: "neutral" | "ai" | "primary";
  /** 语义一句话 */
  semantic: string;
  /** 「能被拿来干什么」—— 必须并列展示后果，不能只给三个单选钮（R3 步骤 3）*/
  canDo: string;
  /** 是否可进正式产出与决策（门控用）*/
  eligibleForDecision: boolean;
}
export const BIND_MODES: BindModeSpec[] = [
  {
    mode: "draft",
    label: "草稿",
    badge: "草稿",
    badgeTone: "neutral",
    semantic: "仅创建者可见，项目侧不出现",
    canDo: "不可被任何下游引用；管理员与项目负责人均不可见",
    eligibleForDecision: false,
  },
  {
    mode: "live",
    label: "实时关联",
    badge: "实时 · 随源变动",
    badgeTone: "ai",
    semantic: "项目侧出现，内容指向 Artifact 当前最新版，随源变动",
    canDo: "可查看、可讨论；不可进正式产出与决策",
    eligibleForDecision: false,
  },
  {
    mode: "snapshot",
    label: "固定快照",
    badge: "已定版 vN",
    badgeTone: "primary",
    semantic: "对当前内容做不可变复制，生成 artifact@vN，记录定版人 / 时间 / Context Pack 引用清单",
    canDo: "正式产出与决策只能绑定它；固定快照不可变、不可删除",
    eligibleForDecision: true,
  },
];

/** 引用资格门控的四个下游动作（UC-8.3 R3 步骤 4 / V1）—— 服务端强制要求固定快照 */
export const DECISION_ACTIONS = [
  "加入报告正式版",
  "提交验收",
  "引用为决策依据",
  "写回图谱与组织大脑",
] as const;

/** 对话侧落地动作集（UC-8.3 R3 步骤 1，按场景分组）*/
export const LANDING_ACTIONS = {
  live: [
    { id: "paste-canvas", label: "贴到本组画布", danger: false },
    { id: "broadcast", label: "转给全场", danger: false },
    { id: "ask-research", label: "让研究模块补证据", danger: false },
  ],
  research: [
    { id: "save-insight", label: "存为洞察", danger: false },
    { id: "add-report", label: "加入报告", danger: false },
    { id: "deep-research", label: "开一场深度研究", danger: false },
  ],
};

/**
 * 对话可见性枚举（UC-8.5 R7；徽标为 [设计] 待裁决——原型线程卡/线程头均无此徽标）
 *
 * ⚠ 原名 `VisibilityScope` —— 与契约 `identity.VisibilityScope` **同名不同义**，
 * 被 `lint-contract-source` 当场拦下（2026-07-29）。契约那个是 artifact 的可见范围
 * `["org-wide","team-only"]`（2 值），这个是**对话**的可见性（5 值），两者不是一回事。
 *
 * 与 phase-00 一致性复核里 `IngestionRun` 的 `status` vs `state` 是同一类问题，
 * 处理方式沿用那次立的纪律：**同名会掩盖分歧，改名而不是合并**。
 * ⇒ 改名 `ChatVisibility`。若日后产品裁定两者本应统一，那是一次签核动作，不是一次改名。
 *
 * ⚠ **2026-07-31 第二轮**：契约随后新建了 `chat.ChatVisibility`（五值），与本类型
 * 四值逐字相同、第五档码不同（契约 `plenary` vs 这里 `all-hands`）。
 * ⇒ 再次改名 `ChatVisibilityView`，取值分歧登记为 `CONTRACT_DIVERGENCES.D05`。
 * **不自己选词**——线上码定成哪个是签核动作。
 */
export type ChatVisibilityView = "member-private" | "group-shared" | "all-hands" | "team-visible" | "private";
export const CHAT_VISIBILITY_LABEL: Record<ChatVisibilityView, string> = {
  "member-private": "组员私聊",
  "group-shared": "本组共享",
  "all-hands": "全场",
  "team-visible": "团队可见",
  private: "私有",
};

/** 落地产出（右栏「产物」标签的真实条目；数量级贴近真实——一个线程可产出多条）*/
export interface LandingArtifact {
  id: string;
  artType: string;
  name: string;
  mode: BindMode;
  version?: string;
  pinnedBy?: string;
  pinnedAt?: string;
  /** 出处回链（AC1）—— 缺失时只能落草稿、不得定版 */
  conversationId: string;
  messageId: string | null;
  citationCount: number;
  /** 未挂来源标灰（AC3）—— 服务端可判定状态，不是纯视觉 */
  hasSource: boolean;
  visibility: ChatVisibilityView;
}
export const LANDING_ARTIFACTS: LandingArtifact[] = [
  {
    id: "art-hyp-tree", artType: "假设树", name: "进入模式",
    mode: "snapshot", version: "v3", pinnedBy: "林可", pinnedAt: "今天 14:36",
    conversationId: "eu-storage", messageId: "m3", citationCount: 3, hasSource: true, visibility: "group-shared",
  },
  {
    id: "art-grid-brief", artType: "简报", name: "德国并网时效核查",
    mode: "live",
    conversationId: "eu-storage", messageId: "m5", citationCount: 1, hasSource: true, visibility: "team-visible",
  },
  {
    id: "art-epc-note", artType: "备忘", name: "EPC 产能风险（口头结论）",
    mode: "draft",
    conversationId: "eu-storage", messageId: null, citationCount: 0, hasSource: false, visibility: "private",
  },
];

/** 门控判定纯函数（对齐服务端；界面只呈现结果，不自定义规则）*/
export function canEnterDecision(a: LandingArtifact): { ok: boolean; reason?: string } {
  if (!a.hasSource) return { ok: false, reason: "未挂来源，不能进报告（先补来源）" };
  if (a.mode !== "snapshot") return { ok: false, reason: "需先定版为固定快照" };
  return { ok: true };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * UC-8.4 预设对话与技能 —— v2 重画（原型有完整一屏，v1 误报「预设 0 命中」）
 *
 * ⚠ v1 逐字宣称「预设二字原型 0 命中…每一个控件都是新设计」。实测 `预设` = 9 处命中，
 *    构成一整屏（原型 wsPhase="chats"，即【工作坊详情 → 对话子页】，引导师视角）：
 *      · 页头「预设对话与技能」（15442983）
 *      · 表头四列「预设对话 | 内置技能 | 下发对象 | 使用」（15447263–15447347）
 *      · JS 数据 chatPresets 4 行带 to/used（16974471）
 *      · 编辑器弹层标题「新建预设对话（下发给组长 / 组员）」+ CTA「保存并下发」（16836655）
 *      · 「预设技能 · 引导师已配好，可增减」（15574080）
 *      · 「下发只给入口，不代替对话」（15448694）
 *
 * ⚠ v1 把三条「权限模型待裁决」摆在签核人面前，原型全部答死（见 PRESET_ANSWERED）：
 *    ① 谁能下发？→ 引导师下发给组长/组员（弹层标题 16836655）
 *    ② 被下发者能改？→ 能改（预设技能·引导师已配好，可增减 15574080）
 *    ③ 被下发者能拒？→ 上架供取用「点开即用」，不是推送（15448694 + newChatFoot 16837179）
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * 下发对象（原型 `to` 字段三取值 = 角色范围；编辑器另有「只给第 N 组」的组覆盖）。
 * ⚠ v1 把它换成了「组范围」（全场/指定组/指定角色），原型主模型是【角色范围】：
 *    全部组长 + 组员 / 全部组长 / 全部组员，编辑器里再叠一个可选的「只给第 4 组」。
 */
export type DispatchTargetKind = "leads-and-members" | "leads" | "members";
export const DISPATCH_TARGET_LABEL: Record<DispatchTargetKind, string> = {
  "leads-and-members": "全部组长 + 组员",
  leads: "全部组长",
  members: "全部组员",
};

/** 预设自带的内置技能（原型：读本组画布 / 缺口检测 / 生成便签 / 反例检索 / 汇报稿…）*/
export interface PresetSkillRef {
  name: string;
  /** 可见性范围：全组织可用 / 仅某组（越范围下发即拒，承接 uc-0-3）*/
  scope: "org" | "group";
  scopeGroup?: string;
}

export interface Preset {
  id: string;
  name: string;
  /** 一句话说明（原型 note，如「对着本组画布找缺什么」）*/
  note: string;
  /** 内置技能（原型「内置技能」列）*/
  skills: PresetSkillRef[];
  /** 下发对象（原型「下发对象」列，角色范围）*/
  to: DispatchTargetKind;
  /** 使用次数（原型「使用」列，如「9 次」= 真实实例数）*/
  used: number;
}

/**
 * 原型 chatPresets 4 行（16974471）——全部是「组员在某个环节现场用的小工具」，
 * 不是 /chat 主屏的战略顾问团队语料（v1 错误 4：搬错了语料）。
 */
export const PRESETS: Preset[] = [
  {
    id: "preset-gap", name: "补齐产出缺口", note: "对着本组画布找缺什么",
    skills: [{ name: "读本组画布", scope: "org" }, { name: "缺口检测", scope: "org" }, { name: "生成便签", scope: "org" }],
    to: "leads-and-members", used: 9,
  },
  {
    id: "preset-devil", name: "唱反调", note: "找最强反例与隐含前提",
    skills: [{ name: "反例检索", scope: "org" }, { name: "前提识别", scope: "org" }],
    to: "leads", used: 4,
  },
  {
    id: "preset-fact", name: "事实核查", note: "核便签里的数字与政策",
    // 「证据检索」仅能源组可见 —— 用来演示「越范围下发即拒」（下方 dispatchScopeViolation）
    skills: [{ name: "事实核查", scope: "org" }, { name: "证据检索", scope: "group", scopeGroup: "能源组" }],
    to: "members", used: 6,
  },
  {
    id: "preset-report", name: "汇报稿三句话", note: "环节末生成可念的稿子",
    skills: [{ name: "汇报稿", scope: "org" }, { name: "口语化", scope: "org" }],
    to: "leads", used: 2,
  },
];

/** 页头 + 规则条（原型逐字）*/
export const PRESET_HEADER = {
  title: "预设对话与技能",
  sub: "预设里带好技能与开场提示，组长和组员在自己视角点开即用，不需要自己配。",
  sectionTitle: "预设对话 · 已下发",
  columns: ["预设对话", "内置技能", "下发对象", "使用"],
  /** 「下发只给入口，不代替对话」——同时是问题 ③「能不能拒」的原型答案 */
  rule: "下发只给入口，不代替对话：组员仍是自己跟 agent 谈，产出默认留在他自己的对话里，除非他主动贴到小组画布。",
};

/**
 * 编辑器弹层（原型 isMNewChat 15570986 + newChat* 16836655）。
 * 标题/CTA/可见性说明/落点提示均取原型原文。
 */
export const PRESET_EDITOR = {
  title: "新建预设对话（下发给组长 / 组员）", // newChatTitle 16836655
  cta: "保存并下发", // newChatCta 16836740
  context: "环节 3 · 假设风暴 · 第 2 组",
  // newChatVis 16836811（引导师视角原文）
  visNote: "预设本身对被下发的人可见；他们各自开始后，生成的是各自私有的对话——组员的对话只有他本人、他的组长和你（引导师）能看到。",
  // newChatFoot 16837179
  foot: "下发后出现在对应角色视角的「点开即用」区",
  // 「从预设开始」四选项（newChatPresets 16837282）
  startFrom: [
    { ab: "GA", name: "补齐产出缺口", note: "读本组画布，指出缺什么、给候选内容" },
    { ab: "DV", name: "唱反调", note: "针对本组结论找最强反例与前提漏洞" },
    { ab: "FC", name: "事实核查", note: "把便签里的数字和政策去查一遍" },
    { ab: "WR", name: "写成一段", note: "把散便签整理成可汇报的三句话" },
  ],
  // 预设技能 · 引导师已配好，可增减（15574080）—— 同时是问题 ②「能不能改」的原型答案
  skillsNote: "预设技能 · 引导师已配好，可增减",
  presetSkills: ["读本组画布", "缺口检测", "生成便签"],
  // 带入的现场上下文（15574887；逐字稿未授权 15575782）
  contextSources: [
    { label: "本环节任务说明", on: true },
    { label: "第 2 组画布 · 14 张便签", on: true },
    { label: "会前问卷结论", on: false },
    { label: "逐字稿（未授权）", on: false, locked: true },
  ],
  // 下发对象（15576002）：角色范围两项 + 可选「只给第 4 组」组覆盖
  dispatchTargets: [
    { id: "leads", label: "全部 4 组组长", on: true },
    { id: "members", label: "全部 12 位组员", on: true },
    { id: "group-4", label: "只给第 4 组", on: false },
  ],
};

/**
 * 消费端（组员视角「点开即用」区）——原型 roleThreads「组员对话 · 5」+
 * 「引导师预设 · N」chip（16913560 附近）。下发后出现在此，点开即用、可拒可忽略。
 */
export const PRESET_CONSUMER = {
  roleLabel: "组员视角 · 点开即用",
  note: "引导师下发的预设出现在这里。点开即用，也可以不用——它是上架供取用，不是推送任务。",
  chips: PRESETS.map((p) => p.name),
};

/**
 * 下发范围校验（V1c）：预设里引用的组范围技能，若下发对象不是它所属组 → 下发即拒。
 * 原型「证据检索」仅能源组可见；下发给全部组员即越界。
 */
export function dispatchScopeViolation(
  preset: Preset,
  targetGroup: string | null,
): { blocked: boolean; offenders: PresetSkillRef[] } {
  const offenders = preset.skills.filter(
    (r) => r.scope === "group" && r.scopeGroup && r.scopeGroup !== targetGroup,
  );
  return { blocked: offenders.length > 0, offenders };
}

/**
 * 三条 v1「待裁决」→ 原型已答（带出处偏移）。界面按此渲染，不再摆成「待裁决」。
 */
export const PRESET_ANSWERED = [
  {
    id: "who-can-dispatch",
    q: "谁能给谁下发预设？",
    answer: "引导师下发给组长 / 组员。屏本身只在引导师视角的工作坊详情下出现。",
    evidence: "弹层标题「新建预设对话（下发给组长 / 组员）」· 偏移 16836655",
  },
  {
    id: "can-recipient-edit",
    q: "被下发者能不能改预设？",
    answer: "能改。技能是「引导师已配好，可增减」，被下发者可在自己视角增删。",
    evidence: "「预设技能 · 引导师已配好，可增减」· 偏移 15574080",
  },
  {
    id: "can-recipient-refuse",
    q: "被下发者能不能拒 / 忽略？",
    answer: "能。这是「上架供取用」而非推送——下发只给入口，出现在「点开即用」区，用不用由本人决定。",
    evidence: "「下发只给入口，不代替对话」偏移 15448694 · newChatFoot「点开即用」偏移 16837179",
  },
] as const;
