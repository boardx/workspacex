/**
 * agent-runtime 预览 mock —— 04-agent / 20-model / 21-mcp 契约束的 UI 先行原型数据。
 *
 * ⚠ 范围声明：这里只放**已有后台原型（lib/mock/admin.ts）里没有的净新数据**——
 *   即各 UC 标为「原型确认缺失 / 需补画」的那些屏。列表屏（Agent/模型/MCP 管理）已在
 *   admin.ts + components/admin/* 存在，本文件不重画，只 re-export 复用其 AGENTS / MODELS /
 *   MCP_SERVERS / MCP_TOOLS，保证「同一 agent 在两处是同一条记录」。
 *
 * ⚠ 契约缺口（待迁入 packages/contracts）：以下形状 phase-1 契约尚未定义，集中放在这里并标注，
 *   sign-off 后应由 requirement-author / 契约束落为 zod schema，mock 再 import：
 *     · ToolWhitelistEntry（工具白名单条目，含越权标记）—— UC-4.1 R3 第 2 步
 *     · ThreeLayerDecision（三层权限求交结果）—— UC-4.1 R7 / O-23；可部分复用契约 PermissionDecision
 *     · ThreadAiTeamMember（线程级 AI 团队 + 三态 + 载入原因）—— UC-4.2 R6
 *     · ProjectAiSwitch（项目级 AI 权限开关）—— UC-4.2 R3 第 4 步
 *     · ToolCallRecord / CallChain（tool-call 四要素 + 调用链深度）—— UC-4.4 R3
 *     · McpSecurityPolicy（四开关 + 可关闭性）—— UC-21.2 R7
 *   provenance 事件类型是**封闭枚举**（packages/contracts/src/provenance.ts）——本文件的
 *   审计事件刻意只用已有枚举值映射；tool-call / model-route 目前**无对应事件类型**，
 *   见 README「界面上无法自洽的点」第 3 条。
 */
import {
  AGENTS, MODELS, MCP_SERVERS, MCP_TOOLS, MCP_AUTH_LABEL,
  OVERVIEW_ANOMALIES, ANOMALY_CHAINS,
  type AgentRow, type ModelRow, type McpRow, type McpAuthScope,
} from "./admin";

export {
  AGENTS, MODELS, MCP_SERVERS, MCP_TOOLS, MCP_AUTH_LABEL,
  OVERVIEW_ANOMALIES, ANOMALY_CHAINS,
};
export type { AgentRow, ModelRow, McpRow, McpAuthScope };

// ─────────────────────────────────────────────────────────────────────────
// 预览屏与预览视角（顶部控制条）
// ─────────────────────────────────────────────────────────────────────────
export type RuntimeScreenKey =
  | "permission" | "mcp-policy" | "routing" | "team" | "chat" | "audit";

export const RUNTIME_SCREENS: { key: RuntimeScreenKey; label: string; uc: string }[] = [
  { key: "permission", label: "三层权限 · 工具白名单", uc: "UC-4.1 / UC-21.1" },
  { key: "mcp-policy", label: "MCP 安全策略 · 放行评审", uc: "UC-21.2" },
  { key: "routing", label: "机密路由 · 批准卡", uc: "UC-20.3 / UC-20.2" },
  { key: "team", label: "AI 团队编排 · 主持台", uc: "UC-4.2" },
  { key: "chat", label: "与 agent 私聊", uc: "UC-4.3" },
  { key: "audit", label: "agent 行为审计", uc: "UC-4.4" },
];

/**
 * 预览视角 —— 只是**界面投影**，真实权限在服务端（NestJS Guard + RLS）。
 * 覆盖本束涉及的所有角色，每屏各取其相关子集。
 */
export type RuntimeRole =
  | "maintainer" | "methodReviewer" | "securityReviewer" | "admin"
  | "facilitator" | "groupLead" | "member" | "observer";

export const RUNTIME_ROLES: { key: RuntimeRole; label: string }[] = [
  { key: "maintainer", label: "能力维护者" },
  { key: "methodReviewer", label: "方法论审核人" },
  { key: "securityReviewer", label: "安全评审人" },
  { key: "admin", label: "组织管理员" },
  { key: "facilitator", label: "引导师" },
  { key: "groupLead", label: "组长" },
  { key: "member", label: "组员" },
  { key: "observer", label: "观察者" },
];
export const RUNTIME_ROLE_LABEL: Record<RuntimeRole, string> = Object.fromEntries(
  RUNTIME_ROLES.map((r) => [r.key, r.label]),
) as Record<RuntimeRole, string>;

// ─────────────────────────────────────────────────────────────────────────
// UC-4.1 · 工具白名单编辑器（MCP 服务器 → 工具 两级树，标注越权申请）
// ─────────────────────────────────────────────────────────────────────────
/** 工具在系统内的唯一命名为 `mcp:<服务器>.<工具>`（内建工具用 `graph.` / `brain.`）。 */
export interface ToolWhitelistEntry {
  toolFullName: string;
  serverId: string;      // 空串 = 内建工具
  serverName: string;
  desc: string;
  writes: boolean;
  /** true = 在该 agent 使用者的 MCP 授权范围内；false = 越权申请，须会签 */
  inScope: boolean;
  checked: boolean;
}

/** Forge（待审核 · 自建）的白名单：含一条越权申请（对应 admin.ts 的 blocker 文案）。 */
export const FORGE_WHITELIST: ToolWhitelistEntry[] = [
  { toolFullName: "graph.search", serverId: "", serverName: "内建", desc: "在项目知识图谱里检索假设/证据", writes: false, inScope: true, checked: true },
  { toolFullName: "brain.recall", serverId: "", serverName: "内建", desc: "从组织大脑复用历史结论", writes: false, inScope: true, checked: true },
  { toolFullName: "mcp:行业数据库.search_market", serverId: "mcp-data", serverName: "行业数据库", desc: "行业规模与增速检索", writes: false, inScope: true, checked: true },
  { toolFullName: "mcp:交付物知识库.search_deliverables", serverId: "mcp-kb", serverName: "交付物知识库", desc: "历史交付物全文检索", writes: false, inScope: true, checked: true },
  { toolFullName: "mcp:客户 CRM.query_contact", serverId: "mcp-crm", serverName: "客户 CRM", desc: "按公司/姓名查客户联系人", writes: false, inScope: false, checked: true },
  { toolFullName: "mcp:客户 CRM.create_task", serverId: "mcp-crm", serverName: "客户 CRM", desc: "在 CRM 建跟进任务（写操作）", writes: true, inScope: false, checked: false },
];

// ─────────────────────────────────────────────────────────────────────────
// UC-4.1 R7 / O-23 · 三层权限求交（有效权限 = ① ∩ ② ∩ ③，收紧优先，下层不得放宽）
// ─────────────────────────────────────────────────────────────────────────
export interface LayerVerdict { passed: boolean; detail: string; }
export interface ThreeLayerDecision {
  id: string;
  scenario: string;         // 一句话场景
  role: RuntimeRole;        // 发起人视角
  tool: string;             // 目标工具全名
  mcpScope: LayerVerdict;   // ① MCP 授权范围（21-mcp）
  whitelist: LayerVerdict;  // ② agent 工具白名单（本用例）
  taskPack: LayerVerdict;   // ③ 任务权限包 R1/R2/R3（00-core）
}

export function effectiveAllowed(d: ThreeLayerDecision): boolean {
  return d.mcpScope.passed && d.whitelist.passed && d.taskPack.passed;
}
/** 「为什么被拒」= 第一条收紧的层（服务端可解释）。 */
export function denialLayer(d: ThreeLayerDecision): "①" | "②" | "③" | null {
  if (!d.mcpScope.passed) return "①";
  if (!d.whitelist.passed) return "②";
  if (!d.taskPack.passed) return "③";
  return null;
}

export const THREE_LAYER_CASES: ThreeLayerDecision[] = [
  {
    id: "tl-ok",
    scenario: "引导师让 Scout 查德国储能市场规模",
    role: "facilitator",
    tool: "mcp:行业数据库.search_market",
    mcpScope: { passed: true, detail: "行业数据库授权范围＝全体成员，覆盖引导师" },
    whitelist: { passed: true, detail: "Scout 白名单含 search_market，在授权范围内" },
    taskPack: { passed: true, detail: "读公开资料恒 R1，无需批准" },
  },
  {
    id: "tl-l1",
    scenario: "普通组员让 Ledger 读客户联系人",
    role: "member",
    tool: "mcp:客户 CRM.query_contact",
    mcpScope: { passed: false, detail: "客户 CRM 授权范围＝仅项目负责人，组员不在范围内" },
    whitelist: { passed: true, detail: "（即便白名单写了也不放宽——下层不得放宽上层）" },
    taskPack: { passed: true, detail: "（即便任务包给了也不放宽）" },
  },
  {
    id: "tl-l2",
    scenario: "项目负责人让 Scout 建 CRM 跟进任务",
    role: "facilitator",
    tool: "mcp:客户 CRM.create_task",
    mcpScope: { passed: true, detail: "负责人在客户 CRM 授权范围内" },
    whitelist: { passed: false, detail: "Scout 白名单不含 create_task，工具级未授权" },
    taskPack: { passed: true, detail: "—" },
  },
  {
    id: "tl-l3",
    scenario: "引导师让 Ledger 外发一封客户邮件",
    role: "facilitator",
    tool: "mcp:企业微信.send_notice",
    mcpScope: { passed: true, detail: "企业微信授权范围＝全体成员" },
    whitelist: { passed: true, detail: "Ledger 白名单含 send_notice" },
    taskPack: { passed: false, detail: "外发邮件恒 R3，任务暂停等人批准" },
  },
];

// ─────────────────────────────────────────────────────────────────────────
// UC-21.2 · MCP 安全策略四开关（含可关闭性裁决 O-19）
// ─────────────────────────────────────────────────────────────────────────
export type SwitchLockKind = "toggleable" | "locked-on" | "locked-off";
export interface McpSecuritySwitch {
  id: string;
  label: string;
  defaultOn: boolean;
  lock: SwitchLockKind;
  /** 关掉（或打开）会发生什么 —— 危险动作必须显式说明后果 */
  consequence: string;
  executedBy: string;
}
export const MCP_SECURITY_SWITCHES: McpSecuritySwitch[] = [
  {
    id: "sw-isolate", label: "新服务器默认隔离，需人工评审后放行", defaultOn: true, lock: "toggleable",
    consequence: "关掉后：此后新注册的 MCP 服务器立即可用、不经评审。需组织管理员二次确认并留痕。",
    executedBy: "本用例（UC-21.2）",
  },
  {
    id: "sw-log", label: "涉客户数据的工具调用全量留痕", defaultOn: true, lock: "toggleable",
    consequence: "关掉后：涉客户数据的调用不再全量留痕（留存期读组织「留痕保留期」参数，非写死 180 天）。需二次确认并留痕。", // [threshold-ok:retentionMaterial] 文案本身说的就是「读参数、非写死」
    executedBy: "本用例 + UC-4.4",
  },
  {
    id: "sw-local", label: "客户机密材料仅允许本地模型处理", defaultOn: true, lock: "locked-on",
    consequence: "不可关闭（只读常开）：它是 O-17（机密标记）与 D-17（出域＝出组织）的执行点，关掉即机密外发。",
    executedBy: "UC-20.3",
  },
  {
    id: "sw-discover", label: "允许 agent 自行发现新 MCP 服务器", defaultOn: false, lock: "locked-off",
    consequence: "phase-1 不提供打开能力（只读常关）：原型无执行证据，做了也无法验收。这是「Agent 自主扩大权限」不包含项的落地点。",
    executedBy: "本用例（UC-21.2）",
  },
];

/** 放行评审结论三选（原型档案 0 命中，属新增设计）。 */
export type ReviewVerdict = "clear" | "hold" | "conditional";
export const REVIEW_VERDICTS: { key: ReviewVerdict; label: string; hint: string }[] = [
  { key: "clear", label: "放行", hint: "放行即要求同时设定授权范围，不允许「放行了但范围没定」" },
  { key: "hold", label: "维持隔离", hint: "记录理由，服务器保持不可用" },
  { key: "conditional", label: "有条件放行（工具级粒度 · 待确认）", hint: "只放行部分工具——工具级放行粒度 phase-1 未定，标待裁决" },
];

// ─────────────────────────────────────────────────────────────────────────
// UC-20.3 / UC-20.2 · 机密数据的模型路由（批准卡 + [改] 候选收窄 + 无本地模型失败态）
// ─────────────────────────────────────────────────────────────────────────
export interface RoutingContextItem {
  source: string;
  label: string;
  confidential: boolean;
}
/** 本次调用装配后的上下文逐项（含机密判定，材料级粒度 O-17）。 */
export const ROUTING_CONTEXT: RoutingContextItem[] = [
  { source: "项目库", label: "远洋 · 欧洲储能进入 · 立项材料", confidential: false },
  { source: "客户资料", label: "客户方电价曲线（2024-2028 预测）", confidential: true },
  { source: "转写", label: "客户 CFO 访谈逐字稿 · 03", confidential: true },
  { source: "行业数据库", label: "德国工商储 LCOE 基准（Statista）", confidential: false },
];
export const ROUTING_HAS_CONFIDENTIAL = ROUTING_CONTEXT.some((i) => i.confidential);

/** 批准卡（UC-4.4 ② + UC-20.3 R8）。 */
export const APPROVAL_CARD = {
  requester: "Ledger",
  chain: "Ava → Ledger",
  chainDepth: 2,
  paused: true,
  comboModelId: "pipe-qwen-local",
  comboModelName: "gpt-5.2 ＋ 本地 qwen3-32b",
  tokenBudget: "800k（约 ￥9.6 · 示例定价）",
  dataLine: "项目库 ＋ 电价曲线 · 含机密，仅本地模型",
  taskName: "三路径 5 年现金流对比模型",
  backAfter: "批准后转后台任务，约 6 分钟回到本线程",
} as const;

/** 机密场景下 [改] 面板的候选：只有已启用的自托管模型可选。 */
export function confidentialModelCandidates(): ModelRow[] {
  return MODELS.filter((m) => m.status === "enabled" && m.kind === "self-hosted");
}

// ─────────────────────────────────────────────────────────────────────────
// UC-4.2 · 线程级 AI 团队编制（6 编制 / 4 在场）+ 载入原因 + 项目级 AI 权限 + 改派
// ─────────────────────────────────────────────────────────────────────────
export type PresenceState = "present" | "running" | "idle";
export const PRESENCE_LABEL: Record<PresenceState, string> = {
  present: "在场",
  running: "跑批中",
  idle: "空闲",
};

export interface ThreadAiMember {
  id: string;
  initials: string;
  name: string;
  role: string;
  ability: string;
  presence: PresenceState;
  /** 因什么载入（触发事件 + 命中规则）—— 原型 0 命中，AC1 载体 */
  loadReason: string;
  model: string;
  downgraded?: string;
}

export const THREAD_AI_TEAM: ThreadAiMember[] = [
  { id: "ag-ava", initials: "AV", name: "Ava", role: "战略分析师", ability: "拆问题、标致命假设、给结论先行", presence: "present", loadReason: "切到议程环节『假设梳理』· 命中蓝本规则「分析环节载入战略分析师」", model: "claude-opus-4.6" },
  { id: "ag-atlas", initials: "AT", name: "Atlas", role: "流程诊断", ability: "把业务流拆成任务，标可自动化环节", presence: "present", loadReason: "同上环节 · 命中规则「诊断类议程载入流程诊断」", model: "claude-sonnet-4.6" },
  { id: "ag-scout", initials: "SC", name: "Scout", role: "同行情报", ability: "找同行 AI 落地案例与一手材料，带引用", presence: "present", loadReason: "引导师手工编制加入（覆盖规则求值，至下次状态变化）", model: "claude-sonnet-4.6" },
  { id: "ag-ledger", initials: "LG", name: "Ledger", role: "收益测算", ability: "算人天节省、单位成本与回本周期", presence: "running", loadReason: "批准卡放行 · 转后台任务（约 6 分钟回到本线程）", model: "gpt-5.2 ＋ 本地 qwen3-32b", downgraded: undefined },
  { id: "ag-warden", initials: "WD", name: "Warden", role: "风险与合规", ability: "数据出域、隐私、模型使用红线", presence: "present", loadReason: "蓝本规则「含客户数据的项目常驻风险与合规」", model: "claude-sonnet-4.6" },
  { id: "ag-echo", initials: "EC", name: "Echo", role: "访谈综合", ability: "转录一线访谈、抽引述、合并同类观点", presence: "idle", loadReason: "在编制内但当前无任务（转录未开始）", model: "whisper ＋ sonnet" },
];

/** 编制数 ≠ 在场数：侧栏「AI 团队 · 6」是编制数，线程头部「团队 4」是在场数。 */
export const TEAM_COUNTS = {
  roster: THREAD_AI_TEAM.length,
  present: THREAD_AI_TEAM.filter((m) => m.presence === "present").length,
} as const;

/** 下一议程环节要换的 agent 提前提示（Backlog，原型无此呈现，需补画）。 */
export const NEXT_SEGMENT_SWAP = {
  nextSegment: "03 方案收敛（25m）",
  willAdd: [{ name: "Devil", role: "魔鬼代言人", why: "收敛环节载入反方论证" }],
  willIdle: [{ name: "Atlas", role: "流程诊断", why: "诊断已完成，转空闲" }],
} as const;

/** 被优先级裁剪掉的 agent（同时命中多条规则时取前 4，避免刷屏）—— 可查，不静默丢弃。 */
export const CLIPPED_BY_PRIORITY = [
  { name: "Sage", role: "行业专家", why: "本可载入但被优先级裁剪（第 5 顺位，超出『取前 4』）" },
  { name: "Quill", role: "文书起草", why: "本可载入但被优先级裁剪（第 6 顺位）" },
];

/** 项目级 AI 权限三开关 —— O-23：默认全关，收紧优先。 */
export interface ProjectAiSwitch {
  id: string;
  label: string;
  defaultOn: boolean;
  offConsequence: string;
  affected: string;
}
export const PROJECT_AI_SWITCHES: ProjectAiSwitch[] = [
  { id: "pa-propose", label: "Facilitator 主动提议收敛", defaultOn: false, offConsequence: "关掉后：AI 不再主动提示投票/收敛，只在被 @ 时回应。", affected: "Ava / Atlas 的主动插话" },
  { id: "pa-transcribe", label: "实时转录与语音转便签", defaultOn: false, offConsequence: "关掉后：现场语音不转文字、不落便签。", affected: "Echo · skill『语音转便签 v4』" },
  { id: "pa-canvas", label: "AI 直接在小组画布落笔", defaultOn: false, offConsequence: "关掉后：AI 只能『提交建议待接受』，不直接落笔（D-10）。", affected: "所有会写画布的 agent" },
];

/** 改派提示条（原型明证）—— 判据是 MCP 授权集，理由须写出具体授权名。 */
export const REASSIGN_HINT = {
  currentAgent: "Ava",
  suggestedAgent: "Scout",
  authName: "行业数据库授权",
  question: "德国工商储 2025 的新增装机预测是多少？",
} as const;

// ─────────────────────────────────────────────────────────────────────────
// UC-4.3 · 与单个 agent 私聊（右侧滑出 + skill 清单 + 转出带出处 + 项目层归属提示）
// ─────────────────────────────────────────────────────────────────────────
export interface ChatSkill { name: string; version: string; }
export interface ChatMessage { id: string; from: "user" | "agent"; text: string; transferable?: boolean; }

export const PRIVATE_CHAT = {
  agentId: "ag-ava",
  agentInitials: "AV",
  agentName: "Ava",
  agentRole: "战略分析师",
  presence: "present" as PresenceState,
  model: "claude-opus-4.6",
  downgraded: undefined as string | undefined,
  /** 顶部固定告知：私聊归项目层，可被审计（O-24 的代价与义务） */
  auditNotice: "本对话属于本项目，可被审计。转出到主线程后即成为项目产出的来源。",
  skills: [
    { name: "MECE 假设拆解", version: "v4" },
    { name: "POV 陈述生成", version: "v2" },
    { name: "数据出域红线核查", version: "v3" },
  ] as ChatSkill[],
  messages: [
    { id: "cm-1", from: "user", text: "帮我判断『客户愿为本地质保付溢价』这条假设的证据强度。" },
    { id: "cm-2", from: "agent", text: "当前项目库与转写里，直接支撑该假设的证据为 0 段：CFO 访谈提到『价格敏感』，与假设方向相反。建议标为致命未验证假设，进下一轮访谈验证。", transferable: true },
    { id: "cm-3", from: "user", text: "那如果做一次小样本报价测试，最少要几个客户？" },
    { id: "cm-4", from: "agent", text: "按二项检验、期望溢价接受率 30%、置信度 90%，最少 12 个有效样本。这是方法学估算，不构成结论。", transferable: true },
  ] as ChatMessage[],
  /** 转出到主线程时携带的出处 */
  transferProvenance: {
    agentVersion: "Ava v7",
    skillVersion: "MECE 假设拆解 v4",
    at: "今天 14:32",
    dataSources: "项目库 12 段 + CFO 访谈转写 03",
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────
// UC-4.4 · agent 行为审计（时间线四类事件 + tool-call 四要素 + 调用链 + 组织级检索）
// ─────────────────────────────────────────────────────────────────────────
export type AuditEventKind = "role" | "version" | "agent-call" | "decision";
export const AUDIT_KIND_LABEL: Record<AuditEventKind, string> = {
  role: "角色变更",
  version: "版本",
  "agent-call": "Agent 调用",
  decision: "决策",
};
export const AUDIT_COUNTS: Record<AuditEventKind | "all", number> = {
  all: 214, role: 8, version: 11, "agent-call": 183, decision: 12,
};

export interface AuditRow {
  id: string;
  kind: AuditEventKind;
  ts: string;
  text: string;
  /** agent-call 事件才可下钻 */
  drillable?: boolean;
}
export const AUDIT_TIMELINE: AuditRow[] = [
  { id: "au-1", kind: "agent-call", ts: "11:20:33", text: "调用 Ava → Ledger · 现金流对比（深度 2） · 412k token · 人已批准", drillable: true },
  { id: "au-2", kind: "decision", ts: "11:18:02", text: "周衡采纳 Ava 的『客户质保溢价假设为致命』结论，转为待办卡" },
  { id: "au-3", kind: "agent-call", ts: "11:05:47", text: "调用 Scout · mcp:行业数据库.search_market(region:DE) · 64 命中 · 12.4k token", drillable: true },
  { id: "au-4", kind: "version", ts: "10:52:10", text: "skill『MECE 假设拆解』从 v3 定版为 v4，Ava 挂载版本随之锁定" },
  { id: "au-5", kind: "agent-call", ts: "10:40:19", text: "拦截 Forge → mcp:客户 CRM.query_contact · 越权（授权范围＝仅项目负责人）· 已拒绝并计数", drillable: true },
  { id: "au-6", kind: "role", ts: "10:31:55", text: "周衡把 agent『Ledger』可见性范围收紧为仅能源组" },
];

/** 一次 agent-call 的下钻视图（tool-call 四要素 + 调用链 + 批准 + 采纳与否）。 */
export interface ToolCallRecord {
  signature: string;
  namespace: "builtin" | "mcp";
  params: string;
  hits: string;
  runState: "done" | "running";
}
export const AUDIT_DRILL = {
  eventId: "au-1",
  title: "Ava → Ledger · 现金流对比",
  agentVersion: "Ledger v5",
  skillVersion: "三路径现金流对比 v3",
  modelId: "gpt-5.2 ＋ 本地 qwen3-32b",
  contextPack: "项目库 12 段 + 电价曲线（含机密）· 可重放",
  thought: "思考了 8.2 秒 · 4 步",
  summary: "工具调用 · 3 ｜ 读了 64 条 · 12.4k token",
  chain: "Ava → Ledger",
  chainDepth: 2,
  approval: "人已批准（周衡 · 11:20:31）",
  adopted: "结论被转成待办卡『补一次报价测试』= 已采纳（结构性断言，不打分）",
  permissionSnapshot: "① 客户 CRM 未涉 · ② 白名单含 roi 工具 · ③ 财务任务 R2 已批准",
  toolCalls: [
    { signature: "graph.search", namespace: "builtin", params: '(project:"远洋", type:["假设","证据"])', hits: "64 命中", runState: "done" },
    { signature: "brain.recall", namespace: "builtin", params: '("资质尽调清单")', hits: "复用 1 份", runState: "done" },
    { signature: "mcp:行业数据库.query_market", namespace: "mcp", params: '(region:"DE")', hits: "运行中", runState: "running" },
  ] as ToolCallRecord[],
} as const;

/** 组织级审计检索屏（D-34 新建，尚无原型 —— 从零补画）。 */
export interface OrgAuditRow { id: string; project: string; who: string; when: string; event: string; }
export const ORG_AUDIT_ROWS: OrgAuditRow[] = [
  { id: "oa-1", project: "欧洲市场进入", who: "Ledger（周衡批准）", when: "今天 11:20", event: "Ava → Ledger 现金流对比（深度 2）· 412k" },
  { id: "oa-2", project: "储能资质尽调", who: "Forge（吴桐）", when: "今天 10:40", event: "越权访问客户 CRM · 已拦截（第 7 次）" },
  { id: "oa-3", project: "华东仓网优化", who: "Scout（陈宇）", when: "昨天 16:02", event: "行业数据库 search_market · 128 命中" },
  { id: "oa-4", project: "欧洲市场进入", who: "Echo（林可）", when: "昨天 14:11", event: "私聊转出结论到主线程 · 带出处" },
];
export const ORG_AUDIT_FILTERS = { projects: ["全部项目", "欧洲市场进入", "储能资质尽调", "华东仓网优化"], people: ["全部成员", "周衡", "吴桐", "陈宇", "林可"] };
