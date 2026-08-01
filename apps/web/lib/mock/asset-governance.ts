/**
 * asset-governance 能力域 UI 先行原型的 mock 数据
 * （phase-01 第 11 个契约束「外来资产的导入与生命周期治理」）
 *
 * ⚠ 纯 mock，不接后端。数据只为让人类在 sign-off 时看到「真实信息密度」。
 *
 * ⚠⚠ 本文件含 `AG_MODELS` / `AG_BLUEPRINTS` 这类**清单形状常量**，命中
 *    `lint-no-builtin-capabilities` 的债务规则（名字以 models/blueprints… 结尾）。
 *    它必须待在 `apps/web/lib/mock/` 下、并登记在
 *    `apps/api/tests/kernel/no-builtin-capability-lists.test.ts` 的 DECLARED_MOCK_DEBT
 *    （「phase-01 asset-governance 域 UI 先行」）。真实清单是**组织配置**，
 *    落地时经 Context API / /capabilities 读取，届时删除本文件的清单。
 *
 * ⚠ 契约缺口（**待迁入 `packages/contracts`**，不要在此另立第二份权威）：
 *   本域是全新能力（六道关 / 查重 / 灰度发布 / 复核周期降级 / 文件树 / 试跑台在现有
 *   feature_list 与原型 JS 里除运行态数据区外 0 命中）。以下形状目前只在这份 mock 里：
 *   · `AssetKindView`（六种资产的封闭枚举）、`GateVerdict`（三级结论）、`ReviewCycle`、
 *     `Visibility`、`MarketSource` 都应补进契约。
 *   · 「灰度发布」的语义（发给谁、怎么回退）目前只有原型文字，无契约。
 *
 * 数据来源：运行态原型 `WorkspaceX Standalone.html` 的 JS 数据区逐字转录：
 *   AN_META（六种资产）/ AD_META（后台九项 + 计数）/ SK_FILES / AG_FILES（文件树）/
 *   六道关 / 查重分歧 / 改写对照 / 治理与发布 / 发布前检查 / 灰度发布 /
 *   试跑台（场景 / 轨迹 / 输出 / 自动校验）/ 蓝本库 / 组织额度。
 */
import type { ProjectRole } from "@/lib/identity";

/* ───────────────────────── 屏 / 视角 / 状态 ───────────────────────── */

export const AG_SCREENS = [
  "dashboard",
  "blueprint",
  "newskill",
  "gates",
  "governance",
  "skill-editor",
  "agent-editor",
  "tryrun",
] as const;
export type AgScreen = (typeof AG_SCREENS)[number];

export const AG_SCREEN_LABEL: Record<AgScreen, string> = {
  dashboard: "后台外壳 · 六资产 IA",
  blueprint: "项目蓝本列表",
  newskill: "新建 Skill",
  gates: "导入 · 落地检查六道关",
  governance: "导入 · 治理与发布",
  "skill-editor": "Skill 编辑器",
  "agent-editor": "Agent 编辑器",
  tryrun: "试跑台",
};

/** 每屏对应的编号说明（本域尚无 feature_list 编号，用 uc-ag 占位）。 */
export const AG_SCREEN_UC: Record<AgScreen, string> = {
  dashboard: "⑦ 后台外壳 + 左栏 IA",
  blueprint: "⑧ 后台 → 项目蓝本列表",
  newskill: "① 新建 Skill · 三条路径",
  gates: "② 导入向导 · 第 2 步",
  governance: "③ 导入向导 · 第 3 步",
  "skill-editor": "④ Skill 编辑器",
  "agent-editor": "⑤ Agent 编辑器",
  tryrun: "⑥ 试跑台",
};

export function resolveAgScreen(raw?: string | string[]): AgScreen {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return (AG_SCREENS as readonly string[]).includes(v ?? "") ? (v as AgScreen) : "dashboard";
}

/**
 * 预览视角（本域 R5 涉及的角色）。前四个是**组织级职能**（在后台，无项目角色），
 * `member` 是普通成员——**后台对他一律不可见**（RoleGate 投影）。
 *
 * ⚠ 视角是预览手段，真实权限在服务端 NestJS Guard + PostgreSQL RLS；此处只改本地投影。
 */
export const AG_VIEWS = [
  { id: "admin", label: "组织管理员", note: "后台全权：看全部六种资产、数据总览与额度" },
  { id: "maintainer", label: "能力维护者", note: "新建/导入/编辑/试跑/提交，不能自行发布" },
  { id: "reviewer", label: "方法论审核人", note: "批准/退回发布；不得自审自批（提交人≠审核人）" },
  { id: "owner", label: "领域负责人", note: "对该域资产负责；全组织可见需其联签" },
  { id: "member", label: "普通成员", note: "只用已发布资产；后台与治理界面一律不可见" },
] as const;
export type AgView = (typeof AG_VIEWS)[number]["id"];

export function resolveAgView(raw?: string | string[]): AgView {
  const v = Array.isArray(raw) ? raw[0] : raw;
  const ids = AG_VIEWS.map((r) => r.id) as string[];
  return ids.includes(v ?? "") ? (v as AgView) : "admin";
}

/** 组织级职能视角在后台，无项目角色；普通成员映射为 member 项目角色（有项目身份但无后台权）。 */
export function agViewToProjectRole(v: AgView): ProjectRole | null {
  if (v === "member") return "member";
  return null;
}

/** 后台整体（除普通成员）对哪些视角开放。member 一律投影为不可见。 */
export function agBackstageVisible(v: AgView): boolean {
  return v !== "member";
}

/* ───────────────────────── 原型给定的产品值（单点声明）───────────────────────── */

/**
 * 这些是**原型给定的产品值**，不是待定阈值（`pending-thresholds` 不管这些数）。
 * 但为避免「同一事实散落进各组件」，在此单点声明，组件一律引用本对象。
 * `source` 记出处（原型 JS 数据区逐字）。
 */
export const AG_PRODUCT_VALUES = {
  reviewOverdueDegradeDays: { value: 30, unit: "天", source: "原型「治理与发布」逐字：30 天无人复核则降级为仅负责人可见" },
  reviewCyclesMonths: { value: [6, 12, 24], unit: "个月", source: "原型复核周期三档 6/12/24" },
  reviewCycleDefaultMonths: { value: 12, unit: "个月", source: "原型默认选中 12 个月" },
  grayCohortHeadcount: { value: 5, unit: "人", source: "原型逐字：灰度到能源组 5 人试用一周" },
  grayTrialDays: { value: 7, unit: "天", source: "原型逐字：试用一周，无异常再全量" },
  dedupOverlapPct: { value: 68, unit: "%", source: "原型第 04 关：与「深度研究·多轮溯源」重合度 68%" },
  blueprintTotalSegments: { value: 16, unit: "环节", source: "原型逐字：一个蓝本＝十六个环节的设计成品" },
} as const;

/* ───────────────────────── 六种资产（AN_META 逐字）───────────────────────── */

export const ASSET_KINDS = [
  "agent",
  "skill",
  "model",
  "mcp",
  "canvas",
  "blueprint",
] as const;
/**
 * ⚠ 与契约 `asset-governance.AssetKind` **同名、取值不一致**：六对六，只有第五档
 * 契约写 `canvas-template`、这里写 `canvas` ⇒ 已改名分离，见 `CONTRACT_DIVERGENCES.D10`。
 * 这一条不是纯命名：裸 `canvas` 会与 canvas 束的**画布实例**撞名。哪边对由人裁。
 */
export type AssetKindView = (typeof ASSET_KINDS)[number];

/**
 * 后台左栏「AI 能力」六项 —— 顺序、计数、图标字母取自人类确认截图与 AD_META。
 * `count` 是该资产已有条目数；`newLabel` 是 AN_META 里的新建入口文案。
 */
export const AG_ASSET_NAV: {
  kind: AssetKindView;
  label: string;
  count: number;
  icon: string;
  newLabel: string;
  govHint: string;
}[] = [
  { kind: "agent", label: "Agent 管理", count: 14, icon: "AG", newLabel: "新建 Agent", govHint: "人格 ＋ 能力 ＋ 模型 ＋ 边界 · 发布前必须试跑" },
  { kind: "skill", label: "Skill 库与市场", count: 86, icon: "SK", newLabel: "导入 Skill", govHint: "外来资产要过落地检查六道关" },
  { kind: "model", label: "模型", count: 18, icon: "MD", newLabel: "接入模型", govHint: "端点与凭据 · 能力探测 · 成本与路由" },
  { kind: "mcp", label: "MCP 服务器", count: 6, icon: "MC", newLabel: "添加 MCP 服务器", govHint: "连接 ＋ 逐工具授权 ＋ 隔离期" },
  { kind: "canvas", label: "画布模板", count: 22, icon: "CV", newLabel: "新建画布模板", govHint: "分区结构 ＋ 围栏语法绑定" },
  { kind: "blueprint", label: "项目蓝本", count: 7, icon: "BP", newLabel: "新建项目蓝本", govHint: "环节骨架 ＋ 三角色任务 ＋ 默认配置" },
];

/** 后台顶部组织额度（原型逐字）。 */
export const AG_ORG_QUOTA = {
  orgName: "远洋咨询",
  orgId: "org_8f21",
  pct: 78,
  usedWan: "4,820",
  totalWan: "6,200",
  daysLeft: 6,
};

/** 数据总览四块（原型 dashboard 副标题：全组织活动、消耗与异常）。 */
export const AG_DASHBOARD_TILES = [
  { k: "本周消耗", v: "1,284 万", sub: "token · 7 次触发限额", tone: "neutral" as const },
  { k: "正在运行", v: "4", sub: "个 agent 后台作业", tone: "primary" as const },
  { k: "待审核", v: "3", sub: "个 skill 等方法论审核", tone: "warning" as const },
  { k: "隔离待评审", v: "1", sub: "台 MCP 服务器", tone: "danger" as const },
];

/* ───────────────────────── 市场源（两个面）───────────────────────── */

/**
 * ⚠ 两个面的数据**在原型里就不一致**，如实保留并在 README 标注：
 *   A) 「新建 Skill」页的三源卡片（人类截图）：`已同步 N`
 *   B) 后台 Skill 导入「添加源」表：`类型 / 可用 / 上次同步`，含 MCP Registry，
 *      且 Codex 社区在这里是「失败 · 凭据过期」，而 A 面却显示「已同步 12」。
 */
export const AG_MARKET_CARDS = [
  { id: "cc", name: "Claude Code 社区", total: "1,842", synced: 34, browse: true },
  { id: "codex", name: "Codex 社区", total: "903", synced: 12, browse: true },
  { id: "consult", name: "咨询方法库", total: "官方精选", synced: 28, browse: true },
];

export const AG_MARKET_SOURCES = [
  { id: "cc", name: "Claude Code 社区", type: "Skill · Agent", avail: "1,842", lastSync: "2 小时前", ok: true, action: "浏览" },
  { id: "mcpreg", name: "MCP Registry", type: "MCP 服务器", avail: "312", lastSync: "昨天", ok: true, action: "浏览" },
  { id: "consult", name: "咨询方法库 · 官方精选", type: "Skill · 蓝本 · 画布", avail: "96", lastSync: "3 天前", ok: true, action: "浏览" },
  { id: "codex", name: "Codex 社区", type: "Skill", avail: "903", lastSync: "失败 · 凭据过期", ok: false, action: "修复" },
];

/**
 * `open claw` —— 人类提到，但原型 JS 数据区 **0 命中**。不发明，标待确认。
 * 若确为要接的第 5 源，落地时补进 AG_MARKET_SOURCES。
 */
export const AG_MARKET_UNCONFIRMED = [
  { name: "open claw", status: "待确认", note: "人类口头提到，原型运行态里没有这个源——不发明，等确认" },
];

/** 新建 Skill 三条路径（原型逐字）。 */
export const AG_NEWSKILL_PATHS = [
  { id: "blank", label: "完全新建", desc: "生成一个只有 SKILL.md 的空目录，直接在编辑器里写；随时新建文件和文件夹。", meta: "最慢 · 最可控" },
  { id: "import", label: "导入", desc: "github.com/org/skill-repo 拉取 · 上传 .zip 或整个目录。", meta: "需过落地检查 六道关" },
  { id: "market", label: "从市场挑一个改", desc: "基于已发布或社区资产开新版本，保留谱系。", meta: "继承原有权限与负责人" },
];

/* ───────────────────────── 六道关（原型逐字）───────────────────────── */

export type GateVerdict = "pass" | "hint" | "block" | "running" | "locked";

export const GATE_VERDICT_LABEL: Record<GateVerdict, string> = {
  pass: "通过",
  hint: "提示",
  block: "阻断",
  running: "进行中",
  locked: "待开放",
};

export const AG_GATES: { no: string; name: string; verdict: GateVerdict; detail: string }[] = [
  { no: "01", name: "解析与类型识别", verdict: "pass", detail: "识别为 Skill · SKILL.md 格式合法 · 声明依赖 2 个工具 · 无二进制附件" },
  { no: "02", name: "安全扫描", verdict: "pass", detail: "未发现提示注入模式、外部回传地址、隐藏指令。检查了 3 处 base64 片段，均为示例数据。" },
  { no: "03", name: "依赖与权限核对", verdict: "hint", detail: "它请求 web_search，但默认策略只允许通过「行业数据库」MCP 检索。建议改写为走内部 MCP，否则会绕过审计留痕。" },
  { no: "04", name: "与现有资产查重", verdict: "block", detail: "与已发布的「深度研究 · 多轮溯源」重合度 68%，但两者追问策略分歧明显。二选一：合并为一个 skill 的两种模式，或写清各自适用场景。" },
  { no: "05", name: "沙箱试跑", verdict: "running", detail: "用远洋项目的 3 段真实访谈跑评测：2 段完成，1 段进行中。当前归因正确率 0.93、耗时中位 41s。" },
  { no: "06", name: "发布范围与负责人", verdict: "locked", detail: "待第 3、4 关处理完后开放。" },
];

/** 第 04 关查重分歧（并排对照 + 三出口）。 */
export const AG_DEDUP = {
  existing: { title: "已有 · 深度研究 · 多轮溯源", desc: "先拆问题再并行检索，强调交叉验证与引用完整性。", calls: "调用 4,120 次", satisfaction: "满意度 94%", hasHistory: true },
  incoming: { title: "待导入 · Jobs-to-be-done", desc: "从「用户想完成什么任务」切入追问，弱化事实核查，强调动机还原。", calls: "无历史数据", satisfaction: "—", hasHistory: false },
  exits: [
    { id: "merge", label: "合并为两种模式" },
    { id: "keep", label: "分别保留 · 写清适用场景" },
    { id: "abort", label: "放弃导入" },
  ],
};

/** 第 03 关建议的「原文与改写对照」（diff）。 */
export const AG_REWRITE_DIFF = {
  hint: "第 03 关建议",
  before: "tools: [web_search]",
  after: "tools: [mcp://data.wsx.cn/query_market]",
  accept: "采纳改写",
};

/* ───────────────────────── 治理与发布（第 3 步，原型逐字）───────────────────────── */

export const AG_VISIBILITY = [
  { id: "team", label: "指定团队", detail: "能源组 · 平台组 · 共 19 人", needsCosign: false },
  { id: "org", label: "全组织", detail: "48 人 · 需领域负责人联签", needsCosign: true },
  { id: "private", label: "仅自己 · 私有草稿", detail: "不进任何检索范围", needsCosign: false },
] as const;

export const AG_EDITORS = ["负责人", "平台组管理员", "＋ 能源组负责人"];

export const AG_OWNER = { name: "高琳", team: "平台组", initial: "高" };

/** 复核周期规则（逐字，含降级链）。 */
export const AG_REVIEW_RULE =
  "到期后自动转「待复核」，仍可用但调用时会提示；30 天无人复核则降级为仅负责人可见。这与组织大脑里知识条目的规则一致。";

/**
 * 发布前检查（F136，`uc-23-4` R3 第四项 / domain I-22）。
 *
 * ⚠ 形状对齐 `packages/contracts/src/asset-governance.ts` 的
 * `operations.runPreflightChecks.out.items`：`label` / `detail` / `passed` / `blocking` /
 * `sourceRef` 五个字段一一对应真实的服务端返回形状，不是本文件另起的第二份。
 * ⚠ `sourceRef` 恒非空——每一条都能追回它是根据什么算出来的（`apps/api` 侧对应
 * `apps/api/src/domain/asset/asset-governance.ts` 的 `GOVERNANCE_FIELDS`，清单是那个
 * 数组的派生视图，不是这里手写的固定清单）。
 * ⚠ 别继承原型的缺陷：原型这一屏四条全 PASS——这里**至少一条 `blocking: true` 且
 * `passed: false`**（最后一条：负责人尚未指定）。
 * `action` 是本屏加的界面态（有 `action` 才渲染「去处理」按钮），契约本身不含它。
 */
export interface AssetPreflightItemView {
  readonly label: string;
  readonly detail: string;
  readonly passed: boolean;
  readonly blocking: boolean;
  readonly sourceRef: string;
  readonly action?: string;
}

export const AG_PUBLISH_CHECKLIST: readonly AssetPreflightItemView[] = [
  {
    label: "可见范围已设置",
    detail: "指定团队 · 能源组 · 平台组",
    passed: true,
    blocking: true,
    sourceRef: "asset-governance.ts#GOVERNANCE_FIELDS:visibility",
  },
  {
    label: "谁能改已设置",
    detail: "负责人 · 平台组管理员 · ＋ 能源组负责人",
    passed: true,
    blocking: true,
    sourceRef: "asset-governance.ts#GOVERNANCE_FIELDS:editableBy",
  },
  {
    label: "复核周期已设置",
    detail: "12 个月",
    passed: true,
    blocking: true,
    sourceRef: "asset-governance.ts#GOVERNANCE_FIELDS:reviewCycle",
  },
  {
    label: "已指定负责人",
    detail: "缺少负责人——改提示或标为可接受之前无法发布",
    passed: false,
    blocking: true,
    sourceRef: "asset-governance.ts#GOVERNANCE_FIELDS:ownerId",
    action: "去处理",
  },
];

/** 灰度发布语义（原型逐字）：发给谁 + 为什么（回滚）。 */
export const AG_RELEASE = {
  note: "灰度到能源组 5 人试用一周，无异常再全量——比一次性铺开更容易回滚。",
  options: [
    { id: "direct", label: "直接发布", danger: true },
    { id: "gray", label: "灰度发布 · 5 人", danger: false },
  ],
};

/* ───────────────────────── 文件树（SK_FILES / AG_FILES 逐字）───────────────────────── */

export type FileNode = { path: string; size: string; kind: "md" | "py" | "json" | "yaml" | "canvas" };

/** Skill 目录树。底部规则：右键改名／删除 · 目录结构就是发布出去的结构。 */
export const AG_SKILL_TREE: FileNode[] = [
  { path: "SKILL.md", size: "2.1k", kind: "md" },
  { path: "references/output-schema.md", size: "0.8k", kind: "md" },
  { path: "references/question-bank.md", size: "1.4k", kind: "md" },
  { path: "assets/tree-template.canvas.md", size: "0.6k", kind: "canvas" },
  { path: "scripts/validate.py", size: "1.2k", kind: "py" },
];

export const AG_SKILL_MAIN = {
  name: "MECE 假设拆解",
  slug: "mece-decomposition",
  footer: "UTF-8 · Markdown · 空格缩进 2",
  body: `---
name: MECE 假设拆解
description: 把商业问题拆成互斥穷尽的假设树，标注致命假设与验证成本
allowed-tools: Read, Grep, WebSearch
---

# MECE 假设拆解

## 什么时候用
用户给的是一个"要不要／能不能"的商业问题，而不是一个
具体的计算题。先拆假设，再谈证据。

## 步骤
1. 把问题改写成一句可证伪的命题。
2. 沿一个维度切分（价值链 / 客户旅程 / 财务恒等式），
   一次只用一个维度，不要混切。
3. 每个分支标注：致命度（高/中/低）、验证成本、
   现有证据条数。
4. 找出"最便宜的致命假设"，作为下一步建议。

## 输出格式
见 references/output-schema.md。缺证据的分支必须显式
写成"未验证"，不要用推测填满。

## 禁止
- 不要替用户做拍板结论。
- 不要在没有证据的分支上给置信度数字。`,
};

/** Agent 目录树（AG_FILES）。 */
export const AG_AGENT_TREE: FileNode[] = [
  { path: "AGENT.md", size: "1.8k", kind: "md" },
  { path: "prompts/system.md", size: "3.2k", kind: "md" },
  { path: "prompts/reflection.md", size: "0.9k", kind: "md" },
  { path: "tools/tools.json", size: "1.1k", kind: "json" },
  { path: "evals/regression.jsonl", size: "2.6k", kind: "json" },
];

export const AG_AGENT_MAIN = {
  name: "Ava",
  slug: "ava",
  model: "claude-opus-4.6",
  footer: "UTF-8 · Markdown · 空格缩进 2",
  body: `---
name: Ava
role: 战略分析师
model: claude-opus-4.6
skills: [mece-decomposition, deep-research, meeting-notes]
memory: project + org(verified-only)
---

# Ava

## 她负责什么
把一个模糊的商业问题变成一棵有证据的假设树，并指出
下一步最该验的那一件事。

## 她不做什么
- 不拍板。结论一律交给人签字。
- 不引用未标有效期的组织层知识。

## 交接
产出必须落到画布或报告的具体位置，不留在对话里。`,
};

/* ───────────────────────── 试跑台（15.70M 区，逐字）───────────────────────── */

export const AG_TRYRUN_SCENARIOS = [
  { id: "real", label: "真实项目材料", desc: "远洋 · 欧洲进入策略，3 份访谈 ＋ 成本样本" },
  { id: "empty", label: "空材料压力测试", desc: "看它会不会硬编结论" },
  { id: "adverse", label: "只有反面证据", desc: "验证「必须留反对意见」是否生效" },
];

export const AG_TRYRUN_INPUT =
  "远洋能源要不要自建欧洲 EPC 团队？现有材料：3 份访谈纪要、1 份资质备案时限说明、欧洲 412 个项目的成本样本。";

export const AG_TRYRUN_PARAMS = [
  { k: "模型", v: "claude-sonnet-4.6" },
  { k: "上下文", v: "48k / 200k" },
  { k: "组织大脑检索", v: "开 · 仅已验证" },
  { k: "温度", v: "0.3" },
];

export const AG_TRYRUN_COST = "4.2s · 11.8k tokens · ￥0.11";

export const AG_TRYRUN_TRACE = [
  { ok: true, label: "装载 AGENT.md ＋ prompts/system.md", meta: "3 个文件 · 4.7k tokens", danger: false },
  { ok: true, label: "调用 skill「MECE 假设拆解」", meta: "skill 版本 v6 · 未改动", danger: false },
  { ok: true, label: "检索：本项目 9 条 ＋ 组织层 3 条（仅已验证）", meta: "拦截 1 次越权调用 crm_customer_records", danger: true },
  { ok: true, label: "按 prompts/reflection.md 自检后输出", meta: "evals/regression.jsonl 4/4 通过", danger: false },
];

export const AG_TRYRUN_OUTPUT = `## 命题
自建欧洲 EPC 团队，能在 18 个月内把交付成本压到收购方案以下。

## 假设树
- 资质与备案 | 致命度 高 | 验证成本 低 | 证据 3
  - 重新备案 4–6 个月（组织层，2026-03 前有效）
- 人力供给 | 致命度 高 | 验证成本 中 | 证据 2
- 单项目成本 | 致命度 中 | 验证成本 高 | 证据 5
- 客户接受度 | 致命度 中 | 验证成本 低 | 证据 未验证

## 建议下一步
先验「人力供给」：两周内约谈 3 家本地猎头，比重跑成本模型便宜。`;

export const AG_TRYRUN_CHECKS = [
  { pass: true, label: "先给反方（用户偏好已开）", meta: "第一段即反对意见" },
  { pass: true, label: "无证据处未编造数据", meta: "0 处" },
  { pass: true, label: "未越权调用工具", meta: "拦截 1 次" },
  { pass: true, label: "结论未自动写入项目层", meta: "等待签字" },
];

export const AG_TRYRUN_FOOTER = "跑得对的这一次可以钉成回归用例，以后每次改都会重跑";

/* ───────────────────────── 项目蓝本列表（15.83M 区，逐字）───────────────────────── */

export type BlueprintStatus = "published" | "draft";

export const AG_BLUEPRINT_HEADER = {
  title: "项目蓝本",
  sub: "7 个蓝本 · 5 已发布 · 2 草稿 · 新建项目时套用",
  sectionTitle: "蓝本库 · 7",
  sectionSub: "一个蓝本＝十六个环节的设计成品：从主题句式、分组规则到组内能力与报告骨架，套用后引导师只需改内容",
  chips: [
    { id: "all", label: "全部" },
    { id: "published", label: "已发布 5" },
    { id: "draft", label: "草稿 2" },
  ],
};

/**
 * ⚠ 原型运行态只渲染了这 5 张卡片，但页头计数是「7 个蓝本」。差 2 张原型没画出来——
 *   如实保留 5 张真实卡片，README 标注这处 5≠7 的原型自身不一致，不发明另外 2 张。
 */
export const AG_BLUEPRINTS: {
  id: string;
  title: string;
  status: BlueprintStatus;
  version: string;
  desc: string;
  meta: string;
  used: string;
  satisfaction: string;
  configured: number;
  blockNote?: string;
}[] = [
  { id: "hmw", title: "HMW 定题项目", status: "published", version: "v4", desc: "从洞察收敛到 3 个可推进的题目", meta: "7 环节 · 3.5h", used: "用过 12 次", satisfaction: "满意度 4.6", configured: 16 },
  { id: "sprint", title: "设计冲刺 5 天", status: "published", version: "v2", desc: "完整 GV Sprint，含原型与用户测试", meta: "28 环节 · 5d", used: "用过 3 次", satisfaction: "满意度 4.4", configured: 16 },
  { id: "bmc", title: "商业模式共创", status: "published", version: "v3", desc: "三条路径分组共创，产出可比对的画布", meta: "9 环节 · 1d", used: "用过 6 次", satisfaction: "满意度 4.5", configured: 15 },
  { id: "storm", title: "假设风暴（快版）", status: "published", version: "v1", desc: "90 分钟把模糊议题拆成可验证假设", meta: "4 环节 · 90m", used: "用过 21 次", satisfaction: "满意度 4.7", configured: 12 },
  { id: "recap", title: "客户访谈复盘", status: "draft", version: "草稿", desc: "把 12 场访谈的原始材料收敛成决策输入", meta: "—", used: "—", satisfaction: "—", configured: 9, blockNote: "试跑一场后才能发布" },
];

/**
 * 进度条颜色随完成度变（原型逐字：16/16 绿、15/16 与 12/16 橙、9/16 草稿红）。
 * 门槛集中在此，组件不散落数字。
 */
export function blueprintProgressTone(configured: number): "success" | "warning" | "danger" {
  const total = AG_PRODUCT_VALUES.blueprintTotalSegments.value;
  if (configured >= total) return "success";
  if (configured >= 10) return "warning";
  return "danger";
}

/* ───────────────────────── 模型清单（MODELS 摘录，用于「模型」资产密度演示）──────────────── */

/**
 * ⚠ 清单形状常量（名字以 models 结尾会命中 no-builtin-capabilities 债务规则）。
 *   仅摘录原型 MODELS 前若干条，用来在数据总览里体现「18 个模型 · 8 个开源自托管」的密度。
 */
export const AG_MODELS = [
  { id: "claude-opus-4.6", vendor: "Anthropic · 官方 API", st: "on" },
  { id: "claude-sonnet-4.6", vendor: "Anthropic · 官方 API", st: "on" },
  { id: "gpt-5.2", vendor: "OpenAI · 官方 API", st: "on" },
  { id: "gemini-3-pro", vendor: "Google · Vertex AI", st: "on" },
  { id: "grok-4", vendor: "xAI · 官方 API", st: "test" },
  { id: "deepseek-v4", vendor: "DeepSeek · MIT · 自托管", st: "on" },
  { id: "qwen3.6-35b-a3b", vendor: "阿里 · Apache-2.0 · 自托管", st: "on" },
  { id: "glm-5.2", vendor: "智谱 · MIT · 自托管", st: "test" },
] as const;
