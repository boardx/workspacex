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
 */

/* ─────────────────────────── AI 团队面板（UC-4.2 / UC-8.2 R3 一） ─────────────────────────── */

/** agent 在场态三取值（enum，不得增删 —— UC-8.2 R7 / UC-4.2 R7）*/
export type AgentPresence = "present" | "batching" | "idle";
export const AGENT_PRESENCE_LABEL: Record<AgentPresence, string> = {
  present: "在场",
  batching: "跑批中",
  idle: "空闲",
};
/** 在场态徽标色调：跑批中=ai（正在工作）、空闲=neutral、在场=primary */
export const AGENT_PRESENCE_TONE: Record<AgentPresence, "primary" | "ai" | "neutral"> = {
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
  presence: AgentPresence;
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
export interface ThreadCard {
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
  threads: ThreadCard[];
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

export type CitationAnchorKind = "page" | "transcript" | "message";
export interface Citation {
  index: number;
  /** 出处全称 */
  sourceFullName: string;
  /** 页码 / 转录时间段 / messageId —— **不能省**，无锚点视为不合格 */
  anchor: string;
  anchorKind: CitationAnchorKind;
}

/* ─────────────────────────── 工具调用（UC-8.2 R7 工具调用层）─────────────────────────── */

export type ToolCallStatus = "done" | "reuse" | "running" | "failed";
export const TOOL_CALL_STATUS_LABEL: Record<ToolCallStatus, string> = {
  done: "完成",
  reuse: "复用",
  running: "运行中",
  failed: "失败",
};
export interface ToolCall {
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
  calls: ToolCall[];
}

/* ─────────────────────────── 消息头角标（UC-8.2 R7 状态可见性）─────────────────────────── */

export type MessageBadge =
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
export type ApprovalStatus = "paused" | "expired" | "approved" | "declined";

export interface ApprovalRequest {
  id: string;
  status: ApprovalStatus;
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
 * 「含机密 → 仅本地模型」是 D-17（出域＝出组织）在界面上的兑现：
 * 这条约束**由数据推出**，服务端强制，界面只呈现判定结果。
 * 语义：含机密的数据只能路由到本地模型；一次运行里云端模型可以并存
 * （只承担非机密部分），但机密数据必须有一个本地模型来承接。
 */
export function dataScopeConstraint(scope: ApprovalDataItem[]): {
  localModelOnly: boolean;
  note: string;
} {
  if (hasConfidential(scope)) {
    return { localModelOnly: true, note: "含机密，仅本地模型" };
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
 * 策略校验：数据含机密（仅本地模型）却**没有任何本地模型**承接 → 返回违规原因。
 * 服务端会在 gateway 层直接拒绝（UC-8.2 V3）；界面用它演示「把模型改到纯云端会被拦」。
 * 返回 null 表示当前模型集合合规。
 */
export function modelPolicyViolation(models: ApprovalModel[], dataScope: ApprovalDataItem[]): string | null {
  const { localModelOnly } = dataScopeConstraint(dataScope);
  if (!localModelOnly) return null;
  const hasLocal = models.some((m) => m.hosting === "local");
  if (hasLocal) return null;
  return "数据范围含机密，仅本地模型；当前无本地模型承接，将被 gateway 拒绝";
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
      badges: MessageBadge[];
      text: string;
      tools?: ToolCallLog;
      citations?: Citation[];
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

/* ─────────────────────────── 右栏五标签（UC-8.2 R3 步骤 13）─────────────────────────── */

export interface RightTab {
  key: string;
  label: string;
  /** null = 无计数（转录）；「已完成/总数」形式用 countDisplay */
  count: number | null;
  countDisplay?: string;
}
export const RIGHT_TABS: RightTab[] = [
  { key: "transcript", label: "转录", count: null },
  { key: "execution", label: "执行", count: 4, countDisplay: "2/4" },
  { key: "insight", label: "洞察", count: 6 },
  { key: "artifact", label: "产物", count: 3 },
  { key: "material", label: "材料", count: 12 },
];

/** 空态：新线程五标签计数全为 0 且不隐藏（UC-8.2 V14）*/
export const RIGHT_TABS_EMPTY: RightTab[] = RIGHT_TABS.map((t) =>
  t.key === "transcript" ? t : { ...t, count: 0, countDisplay: t.key === "execution" ? "0/0" : undefined },
);

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

/** 会议进行中 · 计时（右栏头部）*/
export const TRANSCRIPT_SESSION = {
  status: "会议进行中 · 显示转录",
  elapsed: "28:14",
};
