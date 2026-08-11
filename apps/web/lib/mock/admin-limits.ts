/**
 * 后台「成员配额」屏的另两张 tab —— 用量监控 / 限额策略（backlog B1）。
 *
 * ⚠ 数据来源：`phases/requirements/WorkspaceX Standalone.html` 字节偏移
 *   15851070（成员配额）/ 15851298（用量监控）/ 15851527（限额策略）三按钮同组，
 *   证实是**同一屏三个并列 tab**，不是三个独立左栏菜单项——因此本 feature
 *   不新增 `AdminModuleKey`，只在 `MembersScreen` 内部加 tab 切换。
 *
 * ⚠ 一处判断留痕：原型静态 HTML 里「降级阈值 · 三级 ＋ 按任务分级」
 *   （偏移 15863327 起）与紧邻的任务类型分级表，在字节序上其实嵌在
 *   `isMbQuota`（成员配额）的 `<sc-if>` 块内，而不是 `isMbPolicy`（限额策略）块——
 *   与 `PROTOTYPE-FIDELITY-AUDIT-2.md` 问题3 摘要的归类不一致。
 *   本文件按**语义**归到「限额策略」（降级阈值本质是一条限额规则的组织默认值，
 *   和限额规则列表放一起才连贯），字节序归类差异记录在此，供人类复核。
 *   「按人×模型用量矩阵」与「近期限额事件」则字节序确凿地嵌在 `isMbUsage` 块内，
 *   与摘要归类一致，按字节序放入「用量监控」。
 */

// ─────────────────────────────────────────────────────────────────────────
// 限额策略 tab · 降级阈值（三级，最先触发的一条生效）
// ─────────────────────────────────────────────────────────────────────────
export interface DegradeAgentRow {
  id: string;
  initials: string;
  name: string;
  tone: "violet" | "amber" | "teal";
  detail: string;
}

export const DEGRADE_AGENT_ROWS: DegradeAgentRow[] = [
  { id: "ag-scout", initials: "SC", name: "Scout", tone: "violet", detail: "1.5M/日 · 80%" },
  { id: "ag-ledger", initials: "LG", name: "Ledger", tone: "amber", detail: "800k/次 · 不降级" },
  { id: "ag-ava", initials: "AV", name: "Ava", tone: "teal", detail: "按组织级" },
];

export const DEGRADE_TIERS = {
  org: { label: "组织级", enabled: true, triggerPct: 90, target: "sonnet-4.6" },
  member: {
    label: "成员级",
    enabled: true,
    triggerPct: 85,
    note: "吴桐已达 98%，本周起降级运行",
    noteLink: "给他单独提额",
  },
  agent: {
    label: "Agent 级",
    enabled: true,
    rows: DEGRADE_AGENT_ROWS,
    footnote: "财务建模精度敏感，Ledger 设为不降级、超限直接请人批准",
  },
} as const;

export interface TaskGradingRow {
  key: string;
  taskType: string;
  action: string;
  tone: "success" | "warning" | "destructive";
  reason: string;
}

export const TASK_TYPE_GRADING: TaskGradingRow[] = [
  { key: "generic", taskType: "普通生成", action: "自动降级 ＋ 消息标注", tone: "success", reason: "质量损失可接受，中断成本更高" },
  { key: "research", taskType: "研究 / 财务 / 合规 / 决策辅助", action: "先问人再降级", tone: "warning", reason: "这些结论会进决策链，静默降级等于污染证据" },
  { key: "confidential", taskType: "含客户机密", action: "禁止降级", tone: "destructive", reason: "替代模型不满足隐私与部署要求" },
  { key: "no-fallback", taskType: "无合格替代模型", action: "明确失败", tone: "destructive", reason: "宁可报错，也不给低质量伪结果" },
];

// ─────────────────────────────────────────────────────────────────────────
// 限额策略 tab · 限额规则列表（谁 × 哪个模型 × 什么窗口）
// ─────────────────────────────────────────────────────────────────────────
export type LimitScopeKind = "个人" | "角色" | "团队" | "Agent" | "模型";

export interface LimitRule {
  id: string;
  scopeKind: LimitScopeKind;
  scopeName: string;
  enabled: boolean;
  appliesModel: string;
  window: string;
  cap: string;
  usedPct: number;
  action: string;
  /** 命中「个人 · 吴桐」的两条规则用醒目样式（原型：黄底黄框），因为她已逼近上限 */
  highlighted: boolean;
}

export const LIMIT_RULES: LimitRule[] = [
  { id: "lr-wutong-opus", scopeKind: "个人", scopeName: "吴桐", enabled: true, appliesModel: "claude-opus-4.6", window: "每 5 小时滚动", cap: "80 万 token", usedPct: 96, action: "自动降级到 claude-sonnet-4.6", highlighted: true },
  { id: "lr-wutong-all", scopeKind: "个人", scopeName: "吴桐", enabled: true, appliesModel: "全部模型", window: "每周（自然周）", cap: "600 万 token", usedPct: 93, action: "拒绝调用并提示申请应急池", highlighted: true },
  { id: "lr-consultant-default", scopeKind: "角色", scopeName: "顾问（默认）", enabled: true, appliesModel: "全部闭源 API", window: "每天", cap: "120 万 token", usedPct: 61, action: "自动降级到 deepseek-v4（自托管）", highlighted: false },
  { id: "lr-energy-team", scopeKind: "团队", scopeName: "能源组", enabled: true, appliesModel: "全部模型", window: "每月", cap: "2,000 万 token", usedPct: 74, action: "超出部分转记团队应急池，需负责人确认", highlighted: false },
  { id: "lr-scout-batch", scopeKind: "Agent", scopeName: "Scout · 跑批任务", enabled: true, appliesModel: "claude-opus-4.6", window: "每天", cap: "60 万 token", usedPct: 88, action: "自动降级到 deepseek-v4（自托管）", highlighted: false },
  { id: "lr-gemini-org", scopeKind: "模型", scopeName: "gemini-3-pro 全组织", enabled: false, appliesModel: "gemini-3-pro", window: "每天", cap: "40 万 token", usedPct: 23, action: "排队等待下一个窗口", highlighted: false },
];

export const LIMIT_POLICY_INTRO =
  "限额按「谁 × 哪个模型 × 什么窗口」三段定义。触顶后不是直接失败，而是按这里配置的动作降级或排队——降级目标必须是已测试通过的模型。";

// ─────────────────────────────────────────────────────────────────────────
// 用量监控 tab · 统计窗口 + 概览卡
// ─────────────────────────────────────────────────────────────────────────
export const USAGE_WINDOWS = ["最近 5 小时", "今日", "本周", "本月"] as const;
export type UsageWindowKey = (typeof USAGE_WINDOWS)[number];
export const USAGE_WINDOW_DEFAULT: UsageWindowKey = "本周";

export interface UsageStatCard {
  key: string;
  label: string;
  value: string;
  unit?: string;
  sub: string;
  tone: "default" | "warning" | "destructive";
}

export const USAGE_STAT_CARDS: UsageStatCard[] = [
  { key: "total", label: "本周总消耗", value: "1,284", unit: "万", sub: "↑ 21% vs 上周", tone: "destructive" },
  { key: "cost", label: "折合费用", value: "￥8,410", sub: "其中自托管 0 元", tone: "default" },
  { key: "throttled", label: "触发限额", value: "7", unit: "次", sub: "其中 6 次自动降级成功", tone: "warning" },
  { key: "rejected", label: "已被拒绝", value: "1", unit: "次", sub: "吴桐 · 降级目标同时限流", tone: "destructive" },
];

// ─────────────────────────────────────────────────────────────────────────
// 用量监控 tab · 按人 × 模型用量矩阵
// ─────────────────────────────────────────────────────────────────────────
export const USAGE_MATRIX_MODELS = ["opus-4.6", "sonnet-4.6", "gpt-5.2", "gemini-3-pro", "deepseek-v4"] as const;

export interface UsageMatrixRow {
  id: string;
  name: string;
  subtitle: string;
  values: number[]; // 对齐 USAGE_MATRIX_MODELS 顺序
  total: number;
  quotaPct: number;
}

export const USAGE_MATRIX_ROWS: UsageMatrixRow[] = [
  { id: "linke", name: "林可", subtitle: "项目负责人 · 能源组", values: [142, 96, 31, 18, 44], total: 331, quotaPct: 72 },
  { id: "wutong", name: "吴桐", subtitle: "顾问 · 能源组", values: [386, 74, 12, 6, 128], total: 606, quotaPct: 93 },
  { id: "gaolin", name: "高琳", subtitle: "管理员 · 平台组", values: [48, 112, 62, 9, 20], total: 251, quotaPct: 44 },
  { id: "zhouning", name: "周宁", subtitle: "客户方 · 只读协作", values: [6, 22, 0, 0, 0], total: 28, quotaPct: 12 },
  { id: "agents", name: "Ava / Scout 等 agent", subtitle: "跑批消耗，从团队池扣", values: [24, 31, 8, 5, 0], total: 68, quotaPct: 31 },
];

export const USAGE_MATRIX_FOOTER = {
  label: "按模型合计",
  values: [606, 335, 113, 38, 192],
  total: 1284,
  note: "opus 占 47%",
};

export interface ModelDistributionRow {
  key: string;
  label: string;
  pct: number;
  colorVar: string;
}

export const MODEL_DISTRIBUTION: ModelDistributionRow[] = [
  { key: "opus", label: "claude-opus-4.6", pct: 47, colorVar: "bg-foreground" },
  { key: "sonnet", label: "claude-sonnet-4.6", pct: 26, colorVar: "bg-muted-foreground" },
  { key: "deepseek", label: "deepseek-v4（自托管）", pct: 15, colorVar: "bg-success" },
  { key: "gpt", label: "gpt-5.2", pct: 9, colorVar: "bg-primary" },
  { key: "gemini", label: "gemini-3-pro", pct: 3, colorVar: "bg-warning" },
];

// ─────────────────────────────────────────────────────────────────────────
// 用量监控 tab · 近期限额事件
// ─────────────────────────────────────────────────────────────────────────
export interface UsageLimitEvent {
  id: string;
  tag: "降级" | "拒绝";
  tone: "warning" | "destructive" | "success";
  detail: string;
  meta: string;
}

export const RECENT_LIMIT_EVENTS: UsageLimitEvent[] = [
  { id: "ev-1", tag: "降级", tone: "warning", detail: "吴桐 触顶「opus 每 5 小时 80 万」，后续请求自动切到 claude-sonnet-4.6", meta: "今天 14:12 · 影响 23 次调用" },
  { id: "ev-2", tag: "拒绝", tone: "destructive", detail: "吴桐 触顶「opus 每 5 小时 80 万」时，降级目标 sonnet 也在限流窗口内，无兜底可用", meta: "今天 15:40 · 已通知管理员" },
  { id: "ev-3", tag: "降级", tone: "success", detail: "Scout 触顶「agent 每日 60 万」，切到自托管 deepseek-v4 继续跑", meta: "昨天 22:05 · 未影响交付" },
];
