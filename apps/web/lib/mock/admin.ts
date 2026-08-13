
import type { z } from "zod";
import * as C from "@repo/contracts/identity";
import type { AdminNavCountSource } from "@/lib/admin-nav-counts";
import { A0_TEMPLATES, ORG_TEMPLATES } from "@/lib/mock/canvas";
import { AG_BLUEPRINTS } from "@/lib/mock/asset-governance";
/**
 * 后台（治理）mock 数据 —— 数量级与字段完整度照 PROTOTYPE-DIGEST 第八节实测密度做。
 *
 * ⚠ 两套枚举**刻意分成两个独立类型**，禁止合并（UC-0.3 R7 / UC-21.1 O-20）：
 *   ① VisibilityScope（可见性范围）：agent / skill / 画布模板「谁能看到、谁能用」
 *      —— 取值「全组织可用 / 仅某组」。
 *   ② McpAuthScope（授权范围）：MCP 服务器「谁能通过 agent 调用它的工具」
 *      —— 取值「仅项目负责人 / 仅某团队 / 全体成员」。
 *   另有 ③ McpReviewStatusView（评审状态）与 ② 正交：一台服务器可以同时
 *      「授权范围＝全体成员」且「评审状态＝待安全评审」。三者互不为同一字段。
 *
 * 这些都是**界面投影**，真实权限在服务端（NestJS Guard + RLS）。
 */

// ─────────────────────────────────────────────────────────────────────────
// 模块导航（左栏两组）
// ─────────────────────────────────────────────────────────────────────────
export type AdminModuleKey =
  | "overview" | "agent" | "skill" | "model" | "mcp" | "members" | "feedback"
  // F132：画布模板与项目蓝本。它们本来就是 `AssetKind` 六值中的两个，
  // 左栏却只画了四个 —— 人类那句「为什么在管理后台看不到项目蓝本」问的正是这个。
  // ⚠ 键取原型 `AN_META` 的键（`canvasadmin`），**不是**契约码也不是视图码：
  //   这是路由段/testid 命名空间，与 `CONTRACT_DIVERGENCES.D10`（契约 `canvas-template`
  //   vs 视图 `canvas`）**无关，也不构成对它的裁决**。映射见
  //   `components/admin/asset-kind-nav.ts`。
  | "canvasadmin" | "blueprint"
  // F16：本地组织。归在「组织」组里而不是「AI 能力」组——它是一个组织，
  // 只不过是只有一个人、且数据不出本机的那种。
  | "local";

/**
 * 「AI 能力」组的组名 —— 单点声明。
 * `asset-kind-nav.ts` 的双向门控要按组名从 `ADMIN_NAV` 里取出资产项集合；
 * 组名写两遍就是「同一事实两处」，改一处会让门控静默地检查一个空组（平凡为真）。
 */
export const AI_CAPABILITY_GROUP = "AI 能力";

export interface AdminModuleMeta {
  key: AdminModuleKey;
  label: string;
  href: string;
  /** 该模块承载哪些 UC —— 供 sign-off 回溯 */
  ucRefs: string[];
}

export const ADMIN_NAV: { group: string; items: AdminModuleMeta[] }[] = [
  {
    group: AI_CAPABILITY_GROUP,
    // ⚠ 这一组的**项集合**受 `asset-kind-nav.ts` 的双向门控约束：它必须与契约
    //   `AssetKind` 的取值集合逐个相等。删一项、多一项、或契约加了值这边没跟，都会红。
    //   顺序与分组细节待 Q-11 裁，门控**不锁顺序**。
    items: [
      // 2026-08-11（人类裁决，真合并——见 phases/requirements/DECISIONS-FINAL.md 对应条目）：
      // 上一轮（#928/#929）只改了措辞、加了跳转链接，没有真的把重复入口合掉。这次人类
      // 直接裁决：Q-11/X-J 解除阻塞，五个重复项收敛掉，不再有第二个指向同一能力域的入口。
      //   · 「项目蓝本」→ 改名「项目模板」，href 直接指向 `/tpl/list`（不再经过 `/admin/blueprint`
      //     那个空壳治理页，`templates` 束的蓝本设计器就是它）。
      //     ⚠ 2026-08-14（人类反馈：生产入口不该带原型切换器）：改指 `/tpl/list` 而不是
      //     裸 `/tpl`——`/tpl` 身兼「list 屏」与「一整套 UI-first 原型屏切换器」两职
      //     （`TplNav` 中间导航列 + `PreviewControls` 顶条），`/tpl/list` 是只渲染
      //     `BlueprintListScreen`、不带那套脚手架的生产入口。见 `app/tpl/list/page.tsx`。
      //   · 「Skill 目录」→ href 直接指向 `/skill`（Skill 库与市场，功能更完整的那条真实链路），
      //     原 `/admin/skill` 的简单 CRUD（名称/可见范围/归属团队编辑，`CapabilityCatalogScreen`）
      //     已折进 `/skill` 左栏的新增「目录」屏（`skill-app.tsx` 的 `catalog` screen），
      //     不是被砍掉——旧路由 `/admin/skill` 重定向过去，不留死链。
      // Agent（工具白名单/越权申请/行为审计已折入本屏下方新增区块，见 `agent-screen.tsx`）与
      // MCP / 模型同理：吸收原「智能体运行时」对应子屏的内容，见各自组件头注。
      { key: "agent", label: "Agent 目录", href: "/admin/agent", ucRefs: ["04-agent/uc-4-1", "04-agent/uc-4-4"] },
      { key: "skill", label: "Skill 目录", href: "/skill", ucRefs: ["03-skill/uc-3-1", "03-skill/uc-3-4"] },
      { key: "model", label: "模型", href: "/admin/model", ucRefs: ["20-model/uc-20-1", "20-model/uc-20-2"] },
      { key: "mcp", label: "MCP", href: "/admin/mcp", ucRefs: ["21-mcp/uc-21-1", "21-mcp/uc-21-2"] },
      { key: "canvasadmin", label: "画布模板", href: "/admin/canvasadmin", ucRefs: ["23-asset/uc-23-8", "07-canvas/uc-7-1"] },
      { key: "blueprint", label: "项目模板", href: "/tpl/list", ucRefs: ["23-asset/uc-23-8", "02-tpl/uc-2-1"] },
    ],
  },
  {
    group: "组织",
    items: [
      { key: "overview", label: "总览", href: "/admin", ucRefs: ["17-gov/uc-17-1", "17-gov/uc-17-7"] },
      { key: "members", label: "成员配额", href: "/admin/members", ucRefs: ["17-gov/uc-17-5", "17-gov/uc-17-7"] },
      { key: "feedback", label: "反馈", href: "/admin/feedback", ucRefs: ["17-gov/uc-17-6"] },
      { key: "local", label: "我的本地", href: "/admin/local", ucRefs: ["00-core/uc-0-5"] },
    ],
  },
];

export const ADMIN_MODULE_META: Record<AdminModuleKey, AdminModuleMeta> = Object.fromEntries(
  ADMIN_NAV.flatMap((g) => g.items).map((m) => [m.key, m]),
) as Record<AdminModuleKey, AdminModuleMeta>;

// ─────────────────────────────────────────────────────────────────────────
// 组织概况（顶部额度条）
// ─────────────────────────────────────────────────────────────────────────
export const ORG_HEADER = {
  name: "远洋咨询",
  orgId: "org_8f21",
  quotaUsedWan: 4820, // 万 token
  quotaTotalWan: 6200,
  quotaPct: 78,
  daysLeft: 6,
} as const;

// ─────────────────────────────────────────────────────────────────────────
// 枚举 ①：可见性范围（agent / skill / 画布模板）
// ─────────────────────────────────────────────────────────────────────────
/** ⚠ 从契约派生，不在此处定义第二份（ADR-020 / lint-contract-source） */
export type VisibilityScope = z.infer<typeof C.VisibilityScope>;
export const VISIBILITY_LABEL: Record<VisibilityScope, string> = {
  "org-wide": "全组织可用",
  "team-only": "仅某组",
};

// ─────────────────────────────────────────────────────────────────────────
// 枚举 ②：MCP 授权范围（与①是不同维度，绝不合并）
// ─────────────────────────────────────────────────────────────────────────
export type McpAuthScope = "lead" | "team" | "all";
export const MCP_AUTH_LABEL: Record<McpAuthScope, string> = {
  lead: "仅项目负责人",
  team: "仅某团队",
  all: "全体成员",
};

// ─────────────────────────────────────────────────────────────────────────
// 枚举 ③：MCP 评审状态（与②正交）
// ─────────────────────────────────────────────────────────────────────────
/**
 * ⚠ 与契约 `agent-runtime.McpReviewStatus` **同名、取值不一致**（契约五值中文，
 * 这里二值英文）⇒ 已改名分离，见 `CONTRACT_DIVERGENCES.D03`。
 * 缺失的三态都有独立处置动作（`维持隔离` / `有条件放行` / `已到期待复核`），
 * 不是同义词——**哪边对由人裁**，本文件不选边。
 */
export type McpReviewStatusView = "cleared" | "pending";
export const MCP_REVIEW_LABEL: Record<McpReviewStatusView, string> = {
  cleared: "已放行",
  pending: "待安全评审",
};

// ─────────────────────────────────────────────────────────────────────────
// 总览（UC-17.1 活动流 + UC-17.7 异常）
// ─────────────────────────────────────────────────────────────────────────
export interface MetricCard {
  key: string;
  label: string;
  value: string;
  delta: string;
  trend: "up" | "down" | "flat";
}

export const OVERVIEW_METRICS: MetricCard[] = [
  { key: "tokens", label: "本月 token 消耗", value: "4,820 万", delta: "↑34% vs 上月", trend: "up" },
  { key: "members", label: "活跃成员", value: "47 人", delta: "↑6 人", trend: "up" },
  { key: "anomaly", label: "异常待处理", value: "3 项", delta: "2 额度异常 · 1 越权调用", trend: "flat" },
];

export interface AnomalyItem {
  id: string;
  severity: "high" | "medium";
  kind: string;
  detail: string;
}

export const OVERVIEW_ANOMALIES: AnomalyItem[] = [
  {
    id: "a-crm-breach",
    severity: "high",
    kind: "越权调用",
    detail: "一个自建 agent 尝试访问未授权的 MCP『客户 CRM』，已拦截 7 次。",
  },
  {
    id: "a-quota-wutong",
    severity: "high",
    kind: "额度异常",
    detail: "吴桐（顾问 · 能源组）本月消耗 3.9M，达个人配额 97%，超能源组均值 2.6 倍。",
  },
  {
    id: "a-quota-batch",
    severity: "medium",
    kind: "额度异常",
    detail: "夜间批处理连续 3 晚超组织级 90% 阈值告警，未自动限速（含在跑的重活）。",
  },
];

export interface ActivityItem {
  id: string;
  who: string;
  role: string;
  action: string;
  when: string;
}

export const OVERVIEW_ACTIVITY: ActivityItem[] = [
  { id: "ac-1", who: "高琳", role: "管理员", action: "把模型『moonshot-k2』标记为待测试", when: "12 分钟前" },
  { id: "ac-2", who: "林可", role: "顾问", action: "在『欧洲市场进入』中读取项目内容（已留痕）", when: "34 分钟前" },
  { id: "ac-3", who: "系统", role: "安全", action: "拦截自建 agent 对 MCP『客户 CRM』的调用（第 7 次）", when: "1 小时前" },
  { id: "ac-4", who: "吴桐", role: "顾问", action: "接入开源模型『qwen3-72b』并记录五项测试判读", when: "2 小时前" },
  { id: "ac-5", who: "周衡", role: "项目负责人", action: "将 agent『Ledger』可见性范围收紧为仅能源组", when: "3 小时前" },
  { id: "ac-6", who: "合规负责人", role: "合规", action: "放行 MCP『欧盟法规库』的安全评审（维持隔离）", when: "5 小时前" },
  { id: "ac-7", who: "高琳", role: "管理员", action: "导出上月组织级审计（CSV · 12,408 条）", when: "昨天 18:20" },
];

// ─────────────────────────────────────────────────────────────────────────
// Agent（UC-4.1 R8）
// ─────────────────────────────────────────────────────────────────────────
export type AgentStatus = "running" | "review" | "draft" | "disabled";
export const AGENT_STATUS_LABEL: Record<AgentStatus, string> = {
  running: "运行中",
  review: "待审核",
  draft: "草稿",
  disabled: "已停用",
};

export interface AgentRow {
  id: string;
  initials: string;
  name: string;
  role: string;
  visibility: VisibilityScope;
  team?: string;
  status: AgentStatus;
  model: string;
  skills: number;
  callsPerMonth: number;
  /** 待审核 agent 的阻断说明（如越权申请） */
  blocker?: string;
}

export const AGENTS: AgentRow[] = [
  { id: "ag-ava", initials: "AV", name: "Ava", role: "战略分析师", visibility: "org-wide", status: "running", model: "claude-opus-4.6", skills: 12, callsPerMonth: 3104 },
  { id: "ag-scout", initials: "SC", name: "Scout", role: "市场研究", visibility: "org-wide", status: "running", model: "claude-sonnet-4.6", skills: 8, callsPerMonth: 4120 },
  { id: "ag-echo", initials: "EC", name: "Echo", role: "转录与综合", visibility: "org-wide", status: "running", model: "whisper ＋ sonnet", skills: 5, callsPerMonth: 1930 },
  { id: "ag-ledger", initials: "LG", name: "Ledger", role: "财务建模", visibility: "team-only", team: "能源组", status: "running", model: "gpt-5.2", skills: 6, callsPerMonth: 742 },
  { id: "ag-devil", initials: "DV", name: "Devil", role: "魔鬼代言人", visibility: "org-wide", status: "running", model: "claude-opus-4.6", skills: 3, callsPerMonth: 561 },
  { id: "ag-jobs", initials: "JB", name: "Jobs", role: "产品化与交付", visibility: "org-wide", status: "disabled", model: "gpt-5.2-mini", skills: 4, callsPerMonth: 0 },
  {
    id: "ag-forge", initials: "FG", name: "Forge", role: "自建 · 客户数据整合", visibility: "team-only", team: "能源组",
    status: "review", model: "qwen3-72b", skills: 2, callsPerMonth: 0,
    blocker: "工具白名单里有一条越权申请待确认：申请调用 MCP『客户 CRM』(query_contact)，超出该 agent 使用者的授权范围。需安全评审人 + 组织管理员会签。",
  },
];

// ─────────────────────────────────────────────────────────────────────────
// Skill（UC-3.1 · D-06 声明式契约，不是可执行代码包）
// ─────────────────────────────────────────────────────────────────────────
/**
 * ⚠ 与契约 `skills.SkillStatus` **同名、取值不一致**（契约五值中文含 `被退回`，
 * 这里四值英文）⇒ 已改名分离，见 `CONTRACT_DIVERGENCES.D08`。
 * 🔴 两侧都自称「封闭集合」而数量不同——**必须有一方作废**，那是签核动作。
 */
export type SkillStatusView = "enabled" | "review" | "draft" | "disabled";
export const SKILL_STATUS_LABEL: Record<SkillStatusView, string> = {
  enabled: "已启用",
  review: "待审核",
  draft: "草稿",
  disabled: "已停用",
};

export interface SkillRow {
  id: string;
  name: string;
  duty: string;
  version: string;
  status: SkillStatusView;
  visibility: VisibilityScope;
  team?: string;
  /** 契约三段（D-06）：提示词模板变量数 / schema 字段数 / 数据范围声明 */
  promptVars: number;
  schemaFields: string;
  dataScope: string;
  origin: "手工" | "方法晋升";
  calls: number;
  satisfaction: number; // 0-100
}

export const SKILLS: SkillRow[] = [
  { id: "sk-mece", name: "MECE 假设拆解", duty: "把一个战略问题拆成互斥且穷尽的假设树", version: "v4", status: "enabled", visibility: "org-wide", promptVars: 3, schemaFields: "输入 2 · 输出 5", dataScope: "项目库", origin: "手工", calls: 1842, satisfaction: 92 },
  { id: "sk-pov", name: "POV 陈述生成", duty: "从访谈证据合成用户观点陈述", version: "v2", status: "enabled", visibility: "org-wide", promptVars: 2, schemaFields: "输入 3 · 输出 4", dataScope: "项目库 ＋ 转写", origin: "手工", calls: 903, satisfaction: 88 },
  { id: "sk-roi", name: "三路径现金流对比", duty: "对三条商业路径做敏感性与回本测算", version: "v3", status: "enabled", visibility: "team-only", team: "能源组", promptVars: 4, schemaFields: "输入 6 · 输出 8", dataScope: "项目库 ＋ 电价曲线（含机密，仅本地模型）", origin: "手工", calls: 421, satisfaction: 90 },
  { id: "sk-quote", name: "访谈引述抽取", duty: "从逐字稿抽可引用的一手引述并标段落", version: "v5", status: "enabled", visibility: "org-wide", promptVars: 2, schemaFields: "输入 1 · 输出 3", dataScope: "原始转写（受同意书约束）", origin: "手工", calls: 2210, satisfaction: 94 },
  { id: "sk-persona", name: "用户画像合成", duty: "从多组访谈合并同类观点生成画像", version: "v2", status: "enabled", visibility: "org-wide", promptVars: 3, schemaFields: "输入 4 · 输出 6", dataScope: "项目库 ＋ 转写", origin: "手工", calls: 664, satisfaction: 85 },
  { id: "sk-risk", name: "数据出域红线核查", duty: "核查一条动作是否触发隐私/出域/模型使用红线", version: "v3", status: "enabled", visibility: "org-wide", promptVars: 2, schemaFields: "输入 3 · 输出 2", dataScope: "组织策略库", origin: "手工", calls: 508, satisfaction: 96 },
  { id: "sk-benchmark", name: "同行落地案例检索", duty: "找同行 AI 落地案例与一手材料，带引用", version: "v2", status: "enabled", visibility: "org-wide", promptVars: 3, schemaFields: "输入 2 · 输出 5", dataScope: "MCP:行业数据库（授权范围内）", origin: "手工", calls: 1177, satisfaction: 87 },
  { id: "sk-empathy", name: "语音转便签", duty: "把口头讨论实时转成画布便签", version: "v4", status: "enabled", visibility: "org-wide", promptVars: 1, schemaFields: "输入 1 · 输出 1", dataScope: "本组转写", origin: "手工", calls: 3402, satisfaction: 91 },
  { id: "sk-promote", name: "德国工商储电价机制核查", duty: "核查区域电价机制与并网年报要点", version: "v1", status: "review", visibility: "team-only", team: "能源组", promptVars: 3, schemaFields: "输入 2 · 输出 4", dataScope: "MCP:欧盟法规库（待评审）", origin: "方法晋升", calls: 0, satisfaction: 0 },
  { id: "sk-draft", name: "商业模式画布填充（草稿）", duty: "从假设树初填商业模式九宫格", version: "v1", status: "draft", visibility: "org-wide", promptVars: 4, schemaFields: "输入 3 · 输出 9", dataScope: "项目库", origin: "手工", calls: 0, satisfaction: 0 },
  { id: "sk-legacy", name: "旧版竞品扫描", duty: "已被『同行落地案例检索』取代", version: "v6", status: "disabled", visibility: "org-wide", promptVars: 2, schemaFields: "输入 2 · 输出 4", dataScope: "MCP:行业数据库", origin: "手工", calls: 88, satisfaction: 71 },
];

// ─────────────────────────────────────────────────────────────────────────
// 模型（UC-20.1 / UC-20.2 · D-07：启用/停用 + 可选范围过滤）
// ─────────────────────────────────────────────────────────────────────────
/**
 * ⚠ 原名 `ModelStatus` / `ModelKind` —— 与 `agent-runtime.ts` 的同名契约类型
 * **同名不同义、且取值不一致**，被 `lint-contract-source` 拦下（2026-07-31）。
 *
 * | | 契约（权威） | 本文件（展示层） |
 * |---|---|---|
 * | `ModelKind` | `["closed-api", "self-hosted"]` | `"hosted-api" \| "self-hosted"` |
 * | `ModelStatus` | `["待测试","已启用","已停用","依赖失败"]`（4 值） | `"enabled"\|"disabled"\|"untested"`（3 值） |
 *
 * 🔴 **不只是命名差异**：`closed-api` vs `hosted-api` 是两个不同的词；
 * 状态少一个「依赖失败」。**哪边对需要人类裁决**（登记进签核清单）。
 *
 * 沿用本仓已立九次的纪律：**同名会掩盖分歧，改名而不是合并** ⇒ 加 `View` 后缀。
 * 收敛方向定了之后，本文件应改为从 `@repo/contracts` 派生，而不是保留第二份。
 */
export type ModelStatusView = "enabled" | "disabled" | "untested";
export const MODEL_STATUS_VIEW_LABEL: Record<ModelStatusView, string> = {
  enabled: "已启用",
  disabled: "未启用",
  untested: "待测试",
};

export type ModelKindView = "hosted-api" | "self-hosted";

export interface ModelRow {
  id: string;
  name: string;
  kind: ModelKindView;
  status: ModelStatusView;
  vendor: string;
  /** 能力标签（闭源）/ 许可证·特性（开源） */
  tags: string;
  context: string;
  price: string;
  /** 是否可承接客户机密材料（仅自托管为 true，对齐批准卡「含机密，仅本地模型」） */
  confidentialOk: boolean;
  /** 可选范围过滤（UC-20.2）：哪些能力位可选用它 */
  optionalScope: string;
}

export const MODELS: ModelRow[] = [
  // 闭源 API（凭据由管理员保管，成员看不到）—— 10 台
  { id: "m-gpt52", name: "gpt-5.2", kind: "hosted-api", status: "enabled", vendor: "OpenAI", tags: "推理 · 工具 · 长文", context: "256k", price: "￥0.060 / 1k", confidentialOk: false, optionalScope: "全部能力位" },
  { id: "m-gpt52m", name: "gpt-5.2-mini", kind: "hosted-api", status: "enabled", vendor: "OpenAI", tags: "快速 · 工具", context: "128k", price: "￥0.012 / 1k", confidentialOk: false, optionalScope: "全部能力位" },
  { id: "m-opus46", name: "claude-opus-4.6", kind: "hosted-api", status: "enabled", vendor: "Anthropic", tags: "推理 · 长文 · 中文", context: "500k", price: "￥0.090 / 1k", confidentialOk: false, optionalScope: "全部能力位" },
  { id: "m-sonnet46", name: "claude-sonnet-4.6", kind: "hosted-api", status: "enabled", vendor: "Anthropic", tags: "均衡 · 工具", context: "400k", price: "￥0.018 / 1k", confidentialOk: false, optionalScope: "全部能力位" },
  { id: "m-haiku46", name: "claude-haiku-4.6", kind: "hosted-api", status: "enabled", vendor: "Anthropic", tags: "快速", context: "200k", price: "￥0.006 / 1k", confidentialOk: false, optionalScope: "全部能力位" },
  { id: "m-gem25p", name: "gemini-2.5-pro", kind: "hosted-api", status: "enabled", vendor: "Google", tags: "多模态 · 长文", context: "1M", price: "￥0.021 / 1k", confidentialOk: false, optionalScope: "仅：Scout / Echo" },
  { id: "m-gem25f", name: "gemini-2.5-flash", kind: "hosted-api", status: "disabled", vendor: "Google", tags: "快速 · 多模态", context: "1M", price: "￥0.003 / 1k", confidentialOk: false, optionalScope: "全部能力位" },
  { id: "m-grok4", name: "grok-4", kind: "hosted-api", status: "untested", vendor: "xAI", tags: "推理 · 实时", context: "256k", price: "￥0.030 / 1k", confidentialOk: false, optionalScope: "—" },
  { id: "m-deepseek", name: "deepseek-v3.2", kind: "hosted-api", status: "enabled", vendor: "DeepSeek", tags: "推理 · 中文 · 低价", context: "128k", price: "￥0.002 / 1k", confidentialOk: false, optionalScope: "全部能力位" },
  { id: "m-moonshot", name: "moonshot-k2", kind: "hosted-api", status: "untested", vendor: "Moonshot", tags: "长文 · 中文", context: "256k", price: "￥0.008 / 1k", confidentialOk: false, optionalScope: "—" },
  // 开源自托管（权重跑在自己的 GPU 上，客户机密材料只走这一类）—— 8 台
  { id: "m-qwen32", name: "qwen3-32b", kind: "self-hosted", status: "enabled", vendor: "自托管 · A100×2", tags: "Apache-2.0 · 中文强 · 本地", context: "128k", price: "GPU 摊销", confidentialOk: true, optionalScope: "全部能力位" },
  { id: "m-qwen72", name: "qwen3-72b", kind: "self-hosted", status: "enabled", vendor: "自托管 · H100×4", tags: "Apache-2.0 · 高精度 · 本地", context: "128k", price: "GPU 摊销", confidentialOk: true, optionalScope: "仅：Ledger（机密路由）" },
  { id: "m-llama70", name: "llama-4-70b", kind: "self-hosted", status: "enabled", vendor: "自托管 · A100×4", tags: "Llama-CLA · 通用 · 本地", context: "256k", price: "GPU 摊销", confidentialOk: true, optionalScope: "全部能力位" },
  { id: "m-r170", name: "deepseek-r1-70b", kind: "self-hosted", status: "enabled", vendor: "自托管 · H100×4", tags: "MIT · 深推理 · 本地", context: "128k", price: "GPU 摊销", confidentialOk: true, optionalScope: "全部能力位" },
  { id: "m-mixtral", name: "mixtral-8x22b", kind: "self-hosted", status: "disabled", vendor: "自托管 · A100×4", tags: "Apache-2.0 · MoE · 本地", context: "64k", price: "GPU 摊销", confidentialOk: true, optionalScope: "全部能力位" },
  { id: "m-glm9", name: "glm-4.5-9b", kind: "self-hosted", status: "enabled", vendor: "自托管 · L40S", tags: "MIT · 轻量 · 本地", context: "128k", price: "GPU 摊销", confidentialOk: true, optionalScope: "全部能力位" },
  { id: "m-whisper", name: "whisper-large-v3", kind: "self-hosted", status: "enabled", vendor: "自托管 · L40S", tags: "MIT · 转录 · 本地", context: "—", price: "GPU 摊销", confidentialOk: true, optionalScope: "仅：Echo（转录）" },
  { id: "m-bge", name: "bge-m3-embed", kind: "self-hosted", status: "untested", vendor: "自托管 · L40S", tags: "MIT · 向量 · 本地", context: "8k", price: "GPU 摊销", confidentialOk: true, optionalScope: "—" },
];

export const MODEL_FILTERS = [
  { key: "all", label: "全部", count: 18 },
  { key: "hosted-api", label: "闭源 API", count: 10 },
  { key: "self-hosted", label: "开源自托管", count: 8 },
  { key: "untested", label: "未测试", count: 3 },
] as const;
export type ModelFilterKey = (typeof MODEL_FILTERS)[number]["key"];

// ─────────────────────────────────────────────────────────────────────────
// MCP（UC-21.1 / UC-21.2 · D-07：注册 + 授权范围 + 默认隔离）
// ─────────────────────────────────────────────────────────────────────────
export type McpConnStatus = "connected" | "throttled" | "isolated";
export const MCP_CONN_LABEL: Record<McpConnStatus, string> = {
  connected: "已连接",
  throttled: "限流中",
  isolated: "已隔离",
};

export interface McpRow {
  id: string;
  name: string;
  note: string;
  endpoint: string;
  tools: number;
  /** 枚举② —— 与可见性范围是不同维度 */
  authScope: McpAuthScope;
  authTeam?: string;
  /** 枚举③ —— 与授权范围正交 */
  reviewStatus: McpReviewStatusView;
  conn: McpConnStatus;
  touchesClientData: boolean;
}

export const MCP_SERVERS: McpRow[] = [
  { id: "mcp-crm", name: "客户 CRM", note: "Salesforce 桥接", endpoint: "mcp://crm.internal:7301", tools: 12, authScope: "lead", reviewStatus: "cleared", conn: "connected", touchesClientData: true },
  { id: "mcp-data", name: "行业数据库", note: "Wind ＋ Statista", endpoint: "mcp://data.wsx.cn:443", tools: 28, authScope: "all", reviewStatus: "cleared", conn: "connected", touchesClientData: false },
  { id: "mcp-kb", name: "交付物知识库", note: "历史项目全文检索", endpoint: "mcp://kb.internal:7310", tools: 6, authScope: "all", reviewStatus: "cleared", conn: "connected", touchesClientData: false },
  { id: "mcp-wecom", name: "企业微信", note: "通知与审批推送", endpoint: "mcp://wecom.gw:8080", tools: 4, authScope: "all", reviewStatus: "cleared", conn: "throttled", touchesClientData: false },
  { id: "mcp-timesheet", name: "内部工时系统", note: "人天与投入统计", endpoint: "mcp://ts.internal:7320", tools: 5, authScope: "team", authTeam: "能源组", reviewStatus: "cleared", conn: "connected", touchesClientData: false },
  { id: "mcp-eureg", name: "欧盟法规库", note: "第三方 · 未审计", endpoint: "mcp://eu-reg.vendor.eu", tools: 9, authScope: "all", reviewStatus: "pending", conn: "isolated", touchesClientData: false },
];

/** 标题行统计（UC-21.1 A4） */
export const MCP_SUMMARY = { total: 6, connected: 5, isolated: 1 } as const;

// ─────────────────────────────────────────────────────────────────────────
// 成员配额（UC-17.5 管理员权力边界 + UC-17.7 配额）
// ─────────────────────────────────────────────────────────────────────────
export interface MemberRow {
  id: string;
  name: string;
  orgRole: string;
  team: string;
  usedM: number; // 百万 token
  limitM: number;
  /** 个人层条目数（管理员**只见计数**，内容不可见） */
  privateEntries: number;
}

export const MEMBERS: MemberRow[] = [
  { id: "mb-linke", name: "林可", orgRole: "顾问", team: "能源组", usedM: 2.1, limitM: 4.0, privateEntries: 34 },
  { id: "mb-gaolin", name: "高琳", orgRole: "管理员", team: "平台组", usedM: 1.8, limitM: 4.0, privateEntries: 12 },
  { id: "mb-wutong", name: "吴桐", orgRole: "顾问", team: "能源组", usedM: 3.9, limitM: 4.0, privateEntries: 7 },
  { id: "mb-zhouheng", name: "周衡", orgRole: "项目负责人", team: "能源组", usedM: 2.7, limitM: 4.0, privateEntries: 21 },
  { id: "mb-chenyu", name: "陈宇", orgRole: "顾问", team: "供应链组", usedM: 1.2, limitM: 4.0, privateEntries: 5 },
  { id: "mb-sunqi", name: "孙琪", orgRole: "顾问", team: "供应链组", usedM: 0.9, limitM: 4.0, privateEntries: 3 },
  { id: "mb-liuyang", name: "刘洋", orgRole: "观察者", team: "平台组", usedM: 0.3, limitM: 2.0, privateEntries: 0 },
  { id: "mb-hejing", name: "何静", orgRole: "合规负责人", team: "平台组", usedM: 0.6, limitM: 2.0, privateEntries: 9 },
];

/** 管理员本月的项目层访问记录（可读但必留痕、对负责人可见） */
export interface AdminAccessLog {
  id: string;
  project: string;
  lead: string;
  when: string;
  visibleToLead: boolean;
}
export const ADMIN_ACCESS_LOGS: AdminAccessLog[] = [
  { id: "al-1", project: "欧洲市场进入", lead: "周衡", when: "今天 09:14", visibleToLead: true },
  { id: "al-2", project: "华东仓网优化", lead: "陈宇", when: "昨天 16:02", visibleToLead: true },
  { id: "al-3", project: "储能资质尽调", lead: "周衡", when: "3 天前", visibleToLead: true },
];
export const ADMIN_PROJECT_ACCESS_COUNT = 3;

// ─────────────────────────────────────────────────────────────────────────
// 反馈与迭代（UC-17.6）
// ─────────────────────────────────────────────────────────────────────────
export type SwFeedbackStatus = "pending" | "in-iteration" | "fixed";
export const SW_FEEDBACK_LABEL: Record<SwFeedbackStatus, string> = {
  pending: "待处理",
  "in-iteration": "已进入迭代",
  fixed: "已修复",
};

export interface SwFeedback {
  id: string;
  title: string;
  status: SwFeedbackStatus;
  votes: number;
  detail: string;
  target?: string; // 版本 / 去向
}
export const SW_FEEDBACK: SwFeedback[] = [
  { id: "fb-1", title: "转录侧栏「自动跟随」开关默认应记住上次选择", status: "in-iteration", votes: 14, detail: "已进入下个迭代 · 开发 Agent 已生成技术方案草案", target: "→ v2.16" },
  { id: "fb-2", title: "移动端线程列表滑动卡顿", status: "fixed", votes: 9, detail: "帧率优化，长列表虚拟化", target: "v2.14" },
  { id: "fb-3", title: "批准卡的 token 预算希望能记住上次改的值", status: "pending", votes: 6, detail: "多位顾问反馈每次都要重填", target: undefined },
  { id: "fb-4", title: "画布导出 Markdown 后希望保留便签颜色分区", status: "pending", votes: 5, detail: "与「坐标不写回」规则需要协调", target: undefined },
  { id: "fb-5", title: "后台模型列表希望支持按单价排序", status: "pending", votes: 4, detail: "18 台模型时排序诉求明显", target: undefined },
];
export const SW_FEEDBACK_SUMMARY = { total: 23, pending: 5 } as const;

export interface AgentFeedback {
  id: string;
  initials: string;
  target: string;
  issue: string;
  down: number;
  detail: string;
  outcome?: string;
}
export const AGENT_FEEDBACK: AgentFeedback[] = [
  { id: "af-1", initials: "FC", target: "Facilitator · 打断时机", issue: "打断时机过早", down: 9, detail: "9 位主持人反馈：在讨论未收敛时就提示投票。", outcome: "已生成改进 PR · 待人工复核" },
  { id: "af-2", initials: "SC", target: "Scout · 主动补充", issue: "主动发言未带来源", down: 6, detail: "6 条反馈：主动补充时偶尔不带引用，形成噪音。", outcome: "已上线：主动发言强制带来源" },
  { id: "af-3", initials: "LG", target: "Ledger · 敏感性区间", issue: "低置信度未标注", down: 4, detail: "4 条反馈：现金流敏感性区间未标出置信度。", outcome: undefined },
];

export const ITERATION_LOOP = {
  monthFeedback: 14,
  generatedPR: 9,
  reviewedLive: 6,
} as const;

// ─────────────────────────────────────────────────────────────────────────
// 异常调用链（UC-17.7「查看调用链」下钻）—— 越权/额度异常都能追到具体一次调用
// ─────────────────────────────────────────────────────────────────────────
export interface ChainStep {
  ts: string;
  actor: string;
  action: string;
  /** 该步是否是被拦截/告警的那一步 */
  blocked?: boolean;
}
export const ANOMALY_CHAINS: Record<string, ChainStep[]> = {
  "a-crm-breach": [
    { ts: "10:02:11", actor: "吴桐（顾问 · 能源组）", action: "在项目『储能资质尽调』发起 agent『Forge』一次运行" },
    { ts: "10:02:11", actor: "agent Forge", action: "规划：需要客户联系人 → 拟调用 MCP『客户 CRM』query_contact" },
    { ts: "10:02:12", actor: "NestJS Guard", action: "校验白名单：Forge 使用者授权范围＝仅项目负责人，query_contact 越出", blocked: true },
    { ts: "10:02:12", actor: "系统 · 安全", action: "拒绝调用、写审计、计入异常（本月第 7 次），不向 agent 返回任何 CRM 数据" },
  ],
  "a-quota-wutong": [
    { ts: "本月累计", actor: "吴桐（顾问 · 能源组）", action: "跨 4 个项目累计消耗 3.9M token，达个人配额 97%" },
    { ts: "峰值", actor: "agent Ledger（机密路由）", action: "单次现金流敏感性重算消耗 0.42M（qwen3-72b 本地）" },
    { ts: "对比", actor: "计量流水线", action: "超能源组人均 2.6 倍，触发额度异常阈值告警", blocked: true },
  ],
  "a-quota-batch": [
    { ts: "连续 3 晚", actor: "系统 · 夜间批处理", action: "组织级用量连续 3 晚越过 90% 阈值" },
    { ts: "每晚 02:00", actor: "重活队列", action: "重建全组织 embedding 索引（含在跑的重活），未自动限速", blocked: true },
  ],
};

// ─────────────────────────────────────────────────────────────────────────
// MCP 每台服务器的工具清单（「看工具 / 配置」下钻；能力维护者只读工具名与描述）
// ─────────────────────────────────────────────────────────────────────────
export interface McpTool { name: string; desc: string; writes: boolean; }
export const MCP_TOOLS: Record<string, McpTool[]> = {
  "mcp-crm": [
    { name: "query_contact", desc: "按公司/姓名查客户联系人", writes: false },
    { name: "query_opportunity", desc: "查销售机会与阶段", writes: false },
    { name: "list_account_notes", desc: "读客户跟进备注", writes: false },
    { name: "create_task", desc: "在 CRM 建跟进任务", writes: true },
  ],
  "mcp-data": [
    { name: "search_market", desc: "行业规模与增速检索（Wind/Statista）", writes: false },
    { name: "get_company_profile", desc: "上市公司画像与财报要点", writes: false },
    { name: "compare_peers", desc: "同业对标指标对比", writes: false },
  ],
  "mcp-kb": [
    { name: "search_deliverables", desc: "历史交付物全文检索", writes: false },
    { name: "get_case", desc: "按 case_id 取项目案例", writes: false },
  ],
  "mcp-wecom": [
    { name: "send_notice", desc: "推送通知到企业微信群", writes: true },
    { name: "request_approval", desc: "发起审批流", writes: true },
  ],
  "mcp-timesheet": [
    { name: "get_hours", desc: "查成员人天投入", writes: false },
    { name: "get_project_cost", desc: "查项目人力成本", writes: false },
  ],
  "mcp-eureg": [
    { name: "search_regulation", desc: "欧盟法规条目检索", writes: false },
    { name: "get_article", desc: "取具体条款全文", writes: false },
  ],
};

/**
 * 各能力「当前进行中的调用数」（D-U5）—— 停用二选一确认里的影响范围 N 从这里取，
 * **不写死 0**。数量级照活跃度：运行中的热门能力有并发在跑，冷门/已停用的为 0。
 * 「进行中」= 已发起、尚未返回的调用；停用时它们要么被立即中断，要么允许跑完当前一轮。
 */
export const IN_FLIGHT_CALLS: Record<string, number> = {
  // 模型（被多个 agent 共享，通用强模型并发最高）
  "m-gpt52": 14, "m-opus46": 9, "m-sonnet46": 6, "m-haiku46": 3, "m-deepseek": 5,
  "m-gem25p": 2, "m-qwen32": 4, "m-qwen72": 7, "m-llama70": 2, "m-r170": 1,
  "m-glm9": 1, "m-whisper": 3,
  // agent（正在替人跑的活）
  "ag-ava": 3, "ag-scout": 5, "ag-echo": 2, "ag-ledger": 4, "ag-devil": 1,
  // skill（被 agent 编排调用中）
  "sk-mece": 6, "sk-quote": 8, "sk-empathy": 11, "sk-benchmark": 2, "sk-pov": 1,
  "sk-roi": 3, "sk-persona": 1, "sk-risk": 2,
  // MCP（撤销授权影响的是正经它发起、尚未返回的工具调用）
  "mcp-crm": 2, "mcp-data": 9, "mcp-kb": 3, "mcp-wecom": 1, "mcp-timesheet": 1,
};

/** 取某能力当前进行中的调用数（表外恒为 0，不编造）。 */
export function inFlightOf(id: string): number {
  return IN_FLIGHT_CALLS[id] ?? 0;
}

/** agent 试跑的样例输出（「试跑」面板）—— 让人看到一次真实运行的形态，而非转圈 */
export const AGENT_TRIAL_OUTPUT = {
  input: "为『欧洲储能进入』做一次假设树体检，指出最致命的 3 条未验证假设。",
  steps: [
    "载入 Context Pack（项目库 12 段 + 转写 4 段）",
    "调用 skill『MECE 假设拆解 v4』",
    "对每条假设估算证据覆盖度",
  ],
  output: "① 客户愿为本地质保付溢价（证据 0 段，致命）② 并网审批 ≤6 个月（与年报冲突）③ 竞品定价维持现状（仅 1 段快照支撑）",
  tokens: "输入 8,204 · 输出 1,102",
  model: "claude-opus-4.6",
};

// ─────────────────────────────────────────────────────────────────────────
// 左栏计数来源（F133 / asset-governance I-24）
// ─────────────────────────────────────────────────────────────────────────
/**
 * 每个左栏项的计数来源 —— 一个可能抛错的函数，真实实现里是一次计数查询。
 * 这里对齐**各自屏幕实际渲染的清单长度**（`AGENTS.length` 等），而不是另起一份
 * 手写数字：计数应该等于「你点进去真的能数出来的条目数」，另立一份就是本仓
 * 记过的「同一事实两处」（AGENTS.md 已有五次前科）。
 *
 * ⚠ `local` 恒为 1 —— 不是占位符，是 F16 已裁的产品事实：本地组织恒为单人。
 * ⚠ `overview`/`feedback` 取的是「待处理」而不是「全部」，因为对总览/反馈入口
 *   有意义的数字是「还有多少事要看」，不是历史条目总数；`members` 与六种资产
 *   一样取清单长度，因为成员配额页就是要看「有多少人」。
 *   这条选择本 feature 不锁死——分组/口径细节待 Q-11，门控只锁「取不到显示—、
 *   单类失败不传染」这两条不变量，不锁每一项具体数什么。
 */
export const ADMIN_NAV_COUNT_SOURCES: Record<AdminModuleKey, AdminNavCountSource> = {
  agent: () => AGENTS.length,
  skill: () => SKILLS.length,
  model: () => MODELS.length,
  mcp: () => MCP_SERVERS.length,
  canvasadmin: () => A0_TEMPLATES.length + ORG_TEMPLATES.length,
  blueprint: () => AG_BLUEPRINTS.length,
  overview: () => OVERVIEW_ANOMALIES.length,
  members: () => MEMBERS.length,
  feedback: () => SW_FEEDBACK_SUMMARY.pending,
  local: () => 1,
};
