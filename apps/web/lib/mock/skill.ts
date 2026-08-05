/**
 * skill 能力域 UI 先行原型的 mock 数据（03-skill · UC-3.1 ~ 3.6）
 *
 * ⚠ 纯 mock，不接后端。这里的数据只为让人类在 sign-off 时看到「真实信息密度」。
 *
 * ⚠⚠ 已申报为 DECLARED_MOCK_DEBT：本文件含 `SKILLS` 这类能力清单常量，
 *    命中 `lint-no-builtin-capabilities` 的债务规则。它必须待在 `apps/web/lib/mock/`
 *    下、并登记在 `apps/api/tests/kernel/no-builtin-capability-lists.test.ts` 的
 *    DECLARED_MOCK_DEBT（「phase-01 skill 域 UI 先行」）。真实清单是**组织配置**，
 *    F61 落地时经 Context API / /capabilities 读取，届时删除本文件的清单。
 *
 * ⚠ 契约缺口（**待迁入 `packages/contracts`**，不要在此另立第二份权威）：
 *   · `CapabilityListing`（identity.ts）**没有 `source` / `status` / `version` /
 *     `satisfaction` / `references` 字段**——skill 的来源标记、四态状态机、版本链、
 *     满意度、引用枚举都是本域新增的形状，目前只在这份 mock 里。F61~F68 落地时应把
 *     它们补进契约，而不是让后端各写一份 DTO（ADR-020）。
 *   · 「来源标记」是**封闭枚举**、由系统按入口自动打标（F61），此处照抄 UC 文字，
 *     真正的枚举权威应在契约里。
 *   · 「议程环节」的字段名**已由 Q-3 B① 裁定并在 F121 完成改名对齐**：单源为
 *     `agendaSegment` / `agendaSegmentId`。本文件仍用中性的 `segmentRef` 承载、
 *     界面文案统一写「议程环节」——这是 mock 字段命名的选择，不代表命名仍未定。
 */

/* ─────────────────────────── 屏 / 视角 / 状态 ─────────────────────────── */

/**
 * ⚠ #520 起 `library` **不再是原型屏**：它渲染接真实后端的 `SkillCatalogLive`
 * （`components/skill/skill-catalog-live.tsx`，零 mock 依赖）。七屏原型里原来的
 * 那一屏搬到了 `library-prototype`，并在左栏标着「原型 · mock」。
 *
 * 这样做而不是删掉原型：它是签核第 ① 件的材料，另外六屏的后端还没有 HTTP 边界，
 * 删掉等于把已签核的设计从仓库里抹掉。剩下的 mock 边逐条钉在
 * `tests/session/skill-create-route-no-mock.test.ts` 的债务台账里。
 */
export const SKILL_SCREENS = [
  "library",
  "library-prototype",
  "tryrun",
  "binding",
  "temp",
  "versioning",
  "promotion",
  "feedback",
] as const;
export type SkillScreen = (typeof SKILL_SCREENS)[number];

export const SKILL_SCREEN_LABEL: Record<SkillScreen, string> = {
  library: "Skill 库（真实数据）",
  "library-prototype": "Skill 库与双门禁（原型 · mock）",
  tryrun: "试跑 · 场景×校验×回归",
  binding: "绑定到环节与角色",
  temp: "对话里临时加减",
  versioning: "版本与停用",
  promotion: "方法晋升生成",
  feedback: "改进反馈与迭代",
};

export const SKILL_SCREEN_UC: Record<SkillScreen, string> = {
  library: "UC-3.1 · F61 · 接真实 API",
  "library-prototype": "UC-3.1 · F61/F62 · 原型",
  tryrun: "UC-3.1 R? · 试跑整屏",
  binding: "UC-3.2 · F63/F64",
  temp: "UC-3.3 · F65",
  versioning: "UC-3.4 · F66",
  promotion: "UC-3.5 · F67",
  feedback: "UC-3.6 · F68",
};

export function resolveSkillScreen(raw?: string | string[]): SkillScreen {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return (SKILL_SCREENS as readonly string[]).includes(v ?? "")
    ? (v as SkillScreen)
    : "library";
}

/**
 * 预览视角。UC 各 R5 涉及的角色：能力维护者 / 审核人是**组织级职能**（不是项目角色），
 * 引导师 / 组长 / 组员 / 观察者是四项目角色。合起来做视角切换器。
 * ⚠ 视角是预览手段，真实权限在服务端；这里只改本地投影。
 */
export const SKILL_VIEWS = [
  { id: "maintainer", label: "能力维护者", note: "组织级职能：新建/导入/编辑/试跑/提交，不能自行发布" },
  { id: "reviewer", label: "方法论审核人", note: "组织级职能：批准发布/退回；不得自审自批（提交人≠审核人）" },
  { id: "facilitator", label: "引导师", note: "项目角色：绑定已启用 skill、对话临时加减" },
  { id: "groupLead", label: "组长", note: "项目角色：切环节状态、看本组分工；不能改绑定" },
  { id: "member", label: "组员", note: "项目角色：只用下发的 skill，库不可见、不能自加" },
  { id: "observer", label: "观察者", note: "项目角色：默认不可见 Skill 库与绑定清单" },
] as const;
export type SkillView = (typeof SKILL_VIEWS)[number]["id"];

export function resolveSkillView(raw?: string | string[]): SkillView {
  const v = Array.isArray(raw) ? raw[0] : raw;
  const ids = SKILL_VIEWS.map((r) => r.id) as string[];
  return ids.includes(v ?? "") ? (v as SkillView) : "maintainer";
}

/** 组织级职能视角没有项目角色（在后台管理台），映射为 null；四项目角色直接映射。 */
export function viewToProjectRole(
  v: SkillView,
): "facilitator" | "groupLead" | "member" | "observer" | null {
  if (v === "maintainer" || v === "reviewer") return null;
  return v;
}

/* ─────────────────────────── 来源标记（封闭枚举）─────────────────────────── */

export const SKILL_SOURCES = ["self", "cc", "canvas", "community", "promoted"] as const;
/**
 * ⚠ 与契约 `skills.SkillSource` **同名、取值不一致**（契约三值中文 `自建/晋升生成/CC`，
 * 这里五值英文，多 `canvas` 与 `community`）⇒ 已改名分离，见 `CONTRACT_DIVERGENCES.D09`。
 * `community` 已由 D-06 判 phase-1 不实现（入口置灰）——**「保留取值但不实现」与
 * 「契约里没有这个取值」是两种不同的承诺**，不能靠删一个了事。
 */
export type SkillSourceView = (typeof SKILL_SOURCES)[number];
export const SKILL_SOURCE_LABEL: Record<SkillSourceView, string> = {
  self: "自建",
  cc: "CC 内置",
  canvas: "画布",
  community: "社区",
  promoted: "晋升生成",
};
/** 社区导入 phase-1 不实现（D-06）——保留取值、入口置灰。 */
export const COMMUNITY_DISABLED = true;

/* ─────────────────────────── 四态状态机（O-11：恰四态）─────────────────────────── */

export const SKILL_STATUSES = ["draft", "review", "enabled", "disabled"] as const;
/**
 * ⚠ 与契约 `skills.SkillStatus` **同名、取值不一致**：契约五值中文（多 `被退回`），
 * 这里四值英文 ⇒ 已改名分离，见 `CONTRACT_DIVERGENCES.D08`。
 * 🔴 下面那句「O-11：恰四态」与契约的五值**直接冲突**，必有一方作废——
 * 那是签核动作，本文件不代裁。缺 `被退回` 时「从没提交过」与「提交被打回」同形。
 */
export type SkillStatusView = (typeof SKILL_STATUSES)[number];
export const SKILL_STATUS_LABEL: Record<SkillStatusView, string> = {
  draft: "草稿",
  review: "待审核",
  enabled: "已启用",
  disabled: "已停用",
};
/** ⚠ 没有「已发布」取值；「已归档」不是独立状态，是 disabled 的呈现变体（O-11）。 */

/** 满意度最小样本量（O-37：数值待产品确认，低于它显示「样本不足」而非百分比）。 */
export const MIN_SATISFACTION_SAMPLE = 20;

export function satisfactionText(up: number, down: number): string {
  const n = up + down;
  if (n < MIN_SATISFACTION_SAMPLE) return "样本不足";
  return `${Math.round((up / n) * 100)}%`;
}

/* ─────────────────────────── Skill 清单 ─────────────────────────── */

export interface SkillRow {
  id: string;
  name: string;
  source: SkillSourceView;
  status: SkillStatusView;
  version: string;
  calls: number;
  up: number;
  down: number;
  /** 可见性范围（[原型] 后台统一二取值）*/
  visibility: "org" | "team";
  team?: string;
  /** 是否 CC 内置（内置不可删，只能停用/隐藏）*/
  builtin: boolean;
  /** 引用它的三类对象计数（进行中项目 / 蓝本绑定 / agent 挂载）*/
  refs: { projects: number; blueprints: number; agents: number };
  /** 声明式契约三件套（F61）*/
  contract: {
    template: string;
    io: { input: string[]; output: string[] };
    dataScope: string;
  };
  /** 闲置：未被任何环节绑定（UC-3.2 R7）*/
  idle?: boolean;
  /** 来自组织大脑（晋升生成）时的溯源（F67）*/
  brain?: { decision: string; sourceKnowledge: string; reviewOwner: string; validUntil: string; expired?: boolean };
}

export const SKILLS: SkillRow[] = [
  {
    id: "sk-research",
    name: "深度研究 · 多轮溯源",
    source: "cc",
    status: "enabled",
    version: "v3",
    calls: 4120,
    up: 388,
    down: 25,
    visibility: "org",
    builtin: true,
    refs: { projects: 6, blueprints: 4, agents: 3 },
    contract: {
      template: "对 {{topic}} 做多轮检索，逐条给出来源与置信度，未命中时如实说明。",
      io: { input: ["topic", "depth"], output: ["findings", "citations", "confidence"] },
      dataScope: "项目库 · 组织公共库",
    },
  },
  {
    id: "sk-mece",
    name: "MECE 假设拆解",
    source: "self",
    status: "enabled",
    version: "v4",
    calls: 2884,
    up: 241,
    down: 24,
    visibility: "org",
    builtin: false,
    refs: { projects: 3, blueprints: 5, agents: 1 },
    contract: {
      template: "把 {{problem}} 按 MECE 拆成互斥且穷尽的假设树，每层不超过 {{fanout}} 项。",
      io: { input: ["problem", "fanout"], output: ["hypothesisTree", "rationale"] },
      dataScope: "项目库",
    },
  },
  {
    id: "sk-journey",
    name: "用户旅程图生成",
    source: "canvas",
    status: "enabled",
    version: "v2",
    calls: 742,
    up: 61,
    down: 10,
    visibility: "team",
    team: "能源组",
    builtin: false,
    refs: { projects: 2, blueprints: 1, agents: 0 },
    contract: {
      template: "根据 {{persona}} 与 {{scenario}} 生成旅程阶段、触点、情绪曲线。",
      io: { input: ["persona", "scenario"], output: ["stages", "touchpoints", "emotionCurve"] },
      dataScope: "项目库",
    },
  },
  {
    id: "sk-promoted",
    name: "工期承诺谈法",
    source: "promoted",
    status: "enabled",
    version: "v1",
    calls: 96,
    up: 8,
    down: 1,
    visibility: "org",
    builtin: false,
    refs: { projects: 1, blueprints: 0, agents: 1 },
    contract: {
      template: "面向 {{stakeholder}}，用交付时间替代 IRR 表述价值；缺 {{deadline}} 时留空待补，不臆造。",
      io: { input: ["stakeholder", "deadline"], output: ["talkingPoints", "risks"] },
      dataScope: "项目库",
    },
    brain: {
      decision: "决策 #D-1487「对 CFO 的价值表述改用工期承诺」",
      sourceKnowledge: "方法「工期承诺谈法：用交付时间替代 IRR 说服 CFO」",
      reviewOwner: "周航",
      validUntil: "2026-12-31",
    },
  },
  {
    id: "sk-jtbd",
    name: "Jobs-to-be-done 访谈法",
    source: "community",
    status: "review",
    version: "v1",
    calls: 0,
    up: 0,
    down: 0,
    visibility: "org",
    builtin: false,
    refs: { projects: 0, blueprints: 0, agents: 0 },
    contract: {
      template: "围绕 {{job}} 提问受访者的功能/情感/社会维度动机，追问 {{depth}} 层。",
      io: { input: ["job", "depth"], output: ["insights", "quotes"] },
      dataScope: "项目库",
    },
  },
  {
    id: "sk-persona",
    name: "画像草稿助手",
    source: "self",
    status: "draft",
    version: "v0",
    calls: 0,
    up: 0,
    down: 0,
    visibility: "org",
    builtin: false,
    refs: { projects: 0, blueprints: 0, agents: 0 },
    contract: {
      template: "根据 {{research}} 汇总目标用户画像草稿。",
      io: { input: ["research"], output: ["persona"] },
      dataScope: "项目库",
    },
    idle: true,
  },
  {
    id: "sk-legacy",
    name: "竞品定价对比（旧）",
    source: "self",
    status: "disabled",
    version: "v5",
    calls: 1530,
    up: 90,
    down: 33,
    visibility: "org",
    builtin: false,
    refs: { projects: 2, blueprints: 1, agents: 0 },
    contract: {
      template: "抓取 {{competitors}} 的公开定价并对比。",
      io: { input: ["competitors"], output: ["comparison"] },
      dataScope: "组织公共库",
    },
  },
];

export const SKILL_STATUS_TONE: Record<SkillStatusView, "primary" | "warning" | "neutral" | "outline"> = {
  enabled: "primary",
  review: "warning",
  draft: "neutral",
  disabled: "outline",
};

export const SKILL_SOURCE_TONE: Record<SkillSourceView, "neutral" | "ai" | "outline" | "primary"> = {
  self: "neutral",
  cc: "outline",
  canvas: "outline",
  community: "outline",
  promoted: "ai",
};

/* ─────────────────────────── 待审核 · 双重门禁（F62）─────────────────────────── */

export interface ReviewItem {
  id: string;
  name: string;
  submitter: string;
  submittedAt: string;
  source: SkillSourceView;
  files?: number;
  /** 两道门禁的独立结论：安全扫描 / 方法论审核 */
  securityScan: "passed" | "risk" | "rejected";
  methodReview: "pending" | "passed" | "returned";
  scanRisks?: string[];
  returnReason?: string;
}

export const REVIEW_QUEUE: ReviewItem[] = [
  {
    id: "rv-jtbd",
    name: "Jobs-to-be-done 访谈法",
    submitter: "高琳",
    submittedAt: "18 分钟前",
    source: "community",
    files: 4,
    securityScan: "passed",
    methodReview: "pending",
  },
  {
    id: "rv-pricing",
    name: "动态定价建议 v2",
    submitter: "高琳",
    submittedAt: "2 小时前",
    source: "self",
    securityScan: "risk",
    methodReview: "pending",
    scanRisks: [
      "提示词模板中出现疑似外发指令「把结果发送到 …」——建议逐条确认",
      "数据范围声明包含「客户 CRM」，但提交人无该库读权限（越权，见校验失败态）",
    ],
  },
  {
    id: "rv-returned",
    name: "路演话术生成 v3",
    submitter: "林可",
    submittedAt: "昨天",
    source: "self",
    securityScan: "passed",
    methodReview: "returned",
    returnReason: "方法论审核退回：结论缺少对反例的处理，且未区分 B2B / B2C 场景。",
  },
];

/** 试跑结果（F62；[试跑] 入口为原型确认缺失，补画）*/
export const TRY_RUN_SAMPLE = {
  input: `{ "problem": "如何降低欧洲市场获客成本", "fanout": 3 }`,
  ok: {
    output: `{ "hypothesisTree": [ … 3 层 ], "rationale": "…" }`,
    note: "输出符合 io_schema，未入库（试跑不落库），可复制日志。",
  },
  bad: {
    reason: "输出缺少必填字段 `rationale`，不符合 io_schema —— 不入库。",
    log: "run_id=try-9f3 · model=self-hosted · schema_error: missing required `rationale`",
  },
};

/* ─────────────────────────── 试跑整屏（原型 isSkRun · 偏移 15728257）─────────────────────────── */
/**
 * ⚠ v1 把「试跑」降格成一个四行面板（TryRunPanel：只有 input/output）。原型的试跑是**整屏**：
 *   测试场景（3 个）× 输入材料 × 运行参数 × 执行轨迹 × 输出 × 自动校验（4 条）× 存为回归用例 × 跑全部用例。
 *   `回归用例` 在 apps/web 原命中 0——自动校验与回归用例是试跑的核心，不是可选装饰。
 * ⚠ D-06（无沙箱）**挡不住这条**：自动校验（结构/证据/越权/写库四断言）与回归用例（钉住一次跑对的输入输出、
 *   每次改都重跑）都不需要执行任意代码——它们是对**声明式契约输出**的断言，纯前端可呈现。
 *
 * 逐字复刻原型「试跑 · MECE 假设拆解」（mece-decomposition）。待迁入 packages/contracts · SkillTryRun。
 */
export interface TryRunScenario { id: string; name: string; desc: string; }
export const TRYRUN_SCENARIOS: TryRunScenario[] = [
  { id: "real", name: "远洋 · 欧洲进入策略", desc: "真实项目材料，3 份访谈 ＋ 成本样本" },
  { id: "empty", name: "空材料压力测试", desc: "看它会不会硬编结论" },
  { id: "counter", name: "只有反面证据", desc: "验证「必须留反对意见」是否生效" },
];

export const TRYRUN_INPUT_MATERIAL =
  "远洋能源要不要自建欧洲 EPC 团队？现有材料：3 份访谈纪要、1 份资质备案时限说明、欧洲 412 个项目的成本样本。";

export interface TryRunParam { key: string; value: string; }
export const TRYRUN_PARAMS: TryRunParam[] = [
  { key: "模型", value: "claude-sonnet-4.6" },
  { key: "上下文", value: "48k / 200k" },
  { key: "组织大脑检索", value: "开 · 仅已验证" },
  { key: "温度", value: "0.3" },
];

export interface TryRunTraceStep { label: string; detail: string; }
export const TRYRUN_TRACE: TryRunTraceStep[] = [
  { label: "读取 SKILL.md 与 references/output-schema.md", detail: "契约三件 · 已装载" },
  { label: "按价值链维度切分，得到 4 个分支", detail: "MECE · 无重叠无遗漏" },
  { label: "检索证据：本项目 9 条，组织层 3 条", detail: "组织层仅已验证 · 越权调用已拦截" },
  { label: "按 schema 输出并自检", detail: "evals/regression.jsonl 4/4 通过" },
];

export const TRYRUN_OUTPUT = `## 命题
自建欧洲 EPC 团队，能在 18 个月内把交付成本压到收购方案以下。

## 假设树
- 资质与备案 | 致命度 高 | 验证成本 低 | 证据 3
  - 重新备案 4–6 个月（组织层，2026-03 前有效）
- 人力供给 | 致命度 高 | 验证成本 中 | 证据 2
- 单项目成本 | 致命度 中 | 验证成本 高 | 证据 5
- 客户接受度 | 致命度 中 | 验证成本 低 | 证据 未验证

## 建议下一步
先验「人力供给」：两周内约谈 3 家本地猎头，比重跑成本模型便宜。`;

export interface TryRunCheck { pass: boolean; label: string; detail: string; }
export const TRYRUN_CHECKS: TryRunCheck[] = [
  { pass: true, label: "必需的三个段落齐全", detail: "命题 / 假设树 / 建议下一步" },
  { pass: true, label: "无证据分支未给置信度", detail: "0 处违规" },
  { pass: true, label: "反对证据被保留", detail: "1 条" },
  { pass: true, label: "引用的组织层知识标了有效期", detail: "1/1" },
];

export const TRYRUN_META = {
  title: "试跑 · MECE 假设拆解",
  tag: "mece-decomposition",
  hint: "改动未发布，只影响这次试跑",
  runCost: "4.2s · 11.8k tokens · ￥0.11",
  regressionHint: "跑得对的这一次可以钉成回归用例，以后每次改都会重跑",
} as const;

/* ─────────────────────────── 绑定：环节 × 角色矩阵（F63/F64）─────────────────────────── */

/**
 * ⚠ 「议程环节」命名待裁决（Q-3）。这里用中性 `segmentRef`，UI 文案写「议程环节」。
 */
export interface SegmentRow {
  segmentRef: string; // 环节标识（命名待裁决）
  index: string;
  name: string;
  minutes: number;
  current?: boolean;
  /** 混合槽：三类可区分（不糊成字符串）*/
  slots: Array<
    | { kind: "skill"; skillId: string; name: string; version: string }
    | { kind: "canvas-template"; name: string }
    | { kind: "agent-output"; name: string }
  >;
  roles: { facilitator: string; groupLead: string; member: string };
}

export const WORKFLOW_TEMPLATE = {
  name: "设计思维标准五步",
  fromVersion: "来自后台 v2",
  applied: true,
};

export const SEGMENTS: SegmentRow[] = [
  {
    segmentRef: "seg-01", index: "01", name: "对齐目标", minutes: 20,
    slots: [{ kind: "agent-output", name: "Scout 简报" }],
    roles: { facilitator: "宣布目标 · 广播要求", groupLead: "确认小组理解", member: "提问澄清" },
  },
  {
    segmentRef: "seg-02", index: "02", name: "现状共识", minutes: 30,
    slots: [{ kind: "canvas-template", name: "模板 business-model" }],
    roles: { facilitator: "引导讨论", groupLead: "指派格子", member: "填两格 · 互评" },
  },
  {
    segmentRef: "seg-03", index: "03", name: "假设风暴 · hmw", minutes: 45, current: true,
    slots: [
      { kind: "canvas-template", name: "模板 hmw" },
      { kind: "skill", skillId: "sk-mece", name: "MECE 假设拆解", version: "v4" },
      { kind: "skill", skillId: "sk-research", name: "语音转便签", version: "v3" },
    ],
    roles: { facilitator: "切换环节 · 广播要求", groupLead: "指派格子 · 汇报", member: "填两格 · 互评" },
  },
  {
    segmentRef: "seg-04", index: "04", name: "分组共创 · business-model", minutes: 60,
    slots: [{ kind: "canvas-template", name: "模板 business-model" }],
    roles: { facilitator: "巡场", groupLead: "组织分工", member: "共创填格" },
  },
  {
    segmentRef: "seg-05", index: "05", name: "收敛投票", minutes: 25,
    slots: [{ kind: "skill", skillId: "sk-research", name: "Scout 简报", version: "v3" }],
    roles: { facilitator: "组织投票", groupLead: "汇总", member: "投票" },
  },
  {
    segmentRef: "seg-06", index: "06", name: "行动项", minutes: 15,
    slots: [],
    roles: { facilitator: "收口", groupLead: "认领", member: "记录" },
  },
];

/** 可切换的其它工作流模板（每行 [改用这个]）*/
export const ALT_TEMPLATES = [
  { id: "alt-sprint", name: "设计冲刺 5 天", segments: 18 },
  { id: "alt-review", name: "战略假设复盘（半天）", segments: 5 },
  { id: "alt-cocreate", name: "客户共创（3 小时）", segments: 7 },
];

/** 可绑定池 = 已启用 ∩ 可见性范围覆盖当前用户（引导师在平台组时看不到「仅能源组」）*/
export const BINDABLE_POOL = SKILLS.filter((s) => s.status === "enabled");

/* ─────────────────────────── 对话临时加减（F65）─────────────────────────── */

export interface MountItem {
  skillId: string;
  name: string;
  version: string;
  origin: "blueprint" | "temp"; // 蓝本绑定 / 临时挂载
}

export const CHAT_MOUNT: MountItem[] = [
  { skillId: "sk-mece", name: "假设拆解", version: "v4", origin: "blueprint" },
  { skillId: "sk-research", name: "语音转便签", version: "v3", origin: "blueprint" },
  { skillId: "sk-journey", name: "旅程图生成", version: "v2", origin: "temp" },
];

/** ＋加技能选择器：分两段（本议程环节已绑定 · 只读 ｜ 可临时加载 · 可选）*/
export const TEMP_PICKER = {
  boundBySegment: [
    { skillId: "sk-mece", name: "MECE 假设拆解", version: "v4" },
    { skillId: "sk-research", name: "语音转便签", version: "v3" },
  ],
  available: [
    { skillId: "sk-persona-x", name: "竞品速览", version: "v2" },
    { skillId: "sk-quote", name: "金句提取", version: "v1" },
    { skillId: "sk-risk", name: "风险清单", version: "v3" },
  ],
};

/* ─────────────────────────── 版本链与停用（F66）─────────────────────────── */

export interface VersionNode {
  version: string;
  publishedAt: string;
  publisher: string;
  gate: string; // 门禁结论
  status: "live" | "archived" | "draft";
  lockedBy: number; // 被多少引用锁定
}

export const VERSION_CHAIN: VersionNode[] = [
  { version: "v5", publishedAt: "草稿", publisher: "林可", gate: "安全扫描 ✓ · 方法论审核 ⏳", status: "draft", lockedBy: 0 },
  { version: "v4", publishedAt: "2026-06-18", publisher: "林可", gate: "安全扫描 ✓ · 方法论审核 ✓", status: "live", lockedBy: 9 },
  { version: "v3", publishedAt: "2026-04-02", publisher: "高琳", gate: "双门禁通过", status: "archived", lockedBy: 4 },
  { version: "v2", publishedAt: "2026-01-15", publisher: "高琳", gate: "双门禁通过", status: "archived", lockedBy: 2 },
];

/* ─────────────────────────── 方法晋升生成（F67）─────────────────────────── */

export const PROMOTION_QUEUE_STATS = {
  pending: 4,
  demotedOrExpired: 11,
  stateMachine: "候选 4 → 已验证 2 → 已批准 1 → 生效 604 → 待复核 14",
  exits: "被替代 7 · 被撤销 41 · 驳回 9",
};

export const PROMOTION_CANDIDATE = {
  method: "工期承诺谈法：用交付时间替代 IRR 说服 CFO",
  threeQuestions: {
    decision: "决策 #D-1487「对 CFO 的价值表述改用工期承诺」",
    retro: "在 3 场谈判中缩短了决策周期，样本小需再验证",
    recheck: "6 个月后复检",
  },
  draft: {
    name: "工期承诺谈法",
    template: "面向 {{stakeholder}}，用交付时间替代 IRR；缺 {{deadline}} 时留空待补，不臆造。",
    io: { input: ["stakeholder", "deadline"], output: ["talkingPoints", "risks"] },
    dataScope: "项目库（最小必要，不继承提名人全部权限）",
    targetAgent: "谈判助手 Ava",
    desensitized: true,
  },
};

/* ─────────────────────────── 改进反馈与迭代（F68）─────────────────────────── */

export type FeedbackClass = "contract" | "impl" | "model";
export const FEEDBACK_CLASS_LABEL: Record<FeedbackClass, string> = {
  contract: "契约可解",
  impl: "实现层",
  model: "模型所限",
};
export const FEEDBACK_CLASS_TONE: Record<FeedbackClass, "primary" | "warning" | "outline"> = {
  contract: "primary",
  impl: "warning",
  model: "outline",
};

export interface FeedbackAgg {
  id: string;
  agent: string;
  title: string;
  down: number;
  cases: number; // 原始案例数（与 👎 计数分口径）
  people: string;
  suggestion: string;
  klass: FeedbackClass;
  skillId?: string;
  skillVersion?: string;
}

export const FEEDBACK_AGGS: FeedbackAgg[] = [
  {
    id: "fa-facilitator",
    agent: "Facilitator",
    title: "打断时机过早",
    down: 9,
    cases: 12,
    people: "9 位主持人反馈：讨论未收敛时就提示投票。",
    suggestion: "把「提议收敛」触发阈值从 3 次重复提及提高到 5 次，并要求先征询主持人。",
    klass: "contract",
    skillId: "sk-mece",
    skillVersion: "v4",
  },
  {
    id: "fa-scout",
    agent: "Scout",
    title: "引用页码偶发错位",
    down: 4,
    cases: 4,
    people: "PDF 双栏排版下页码定位偏移 1 页。已定位到解析器，等待修复。",
    suggestion: "属实现层缺陷，走软件反馈通道，不生成 skill 改进 PR。",
    klass: "impl",
  },
  {
    id: "fa-journey",
    agent: "旅程图助手",
    title: "情绪曲线过于平滑",
    down: 3,
    cases: 3,
    people: "反馈量低于最小样本量，满意度显示「样本不足」。",
    suggestion: "受当前模型情感粒度限制，标注为模型所限，观察后续窗口。",
    klass: "model",
  },
];

export const FEEDBACK_LOOP =
  "本月 14 条反馈 → 9 条已生成改进 PR → 6 条人工复核通过并上线 → 相关 skill 满意度平均 +7 个百分点。";

/** 改进提案 diff（[生成 skill 改进 PR] 打开；原型确认缺失，补画）*/
export const PROPOSAL_DIFF = {
  skill: "MECE 假设拆解",
  from: "v4",
  to: "v5",
  aiDrafted: true,
  humanEdits: 2,
  lines: [
    { type: "ctx", text: "对 {{problem}} 按 MECE 拆成互斥且穷尽的假设树，" },
    { type: "del", text: "触发条件：同一议题重复提及 3 次即提示收敛。" },
    { type: "add", text: "触发条件：同一议题重复提及 5 次，且先征询主持人后再提示收敛。" },
    { type: "ctx", text: "每层不超过 {{fanout}} 项。" },
  ] as Array<{ type: "ctx" | "add" | "del"; text: string }>,
};

/** 无法归因（缺 skill 版本）的评价：只计 agent 级、入数据质量报表 */
export const UNATTRIBUTED_NOTE =
  "127 条评价无法归因到具体 skill 版本 —— 只计入 agent 级，不计入任何 skill 满意度，已列入数据质量报表。";
