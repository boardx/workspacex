/**
 * Phase-20 work-stack-foundation UI 原型 mock 数据（单一来源）。
 * ADR-023 签核第 ① 件材料，纯前端，不接后端、不发明后端契约。
 * 字段形状对齐 requirements/work-stack-v2 与各束 usecases/domain.md 的描述，
 * 但**只用于原型演示**；真实契约以 packages/contracts 落地为准。
 */

/** 七态：默认 / 加载 / 空 / 校验失败 / 依赖失败 / 无权限 / 成功 */
export type PreviewState =
  | "default"
  | "loading"
  | "empty"
  | "invalid"
  | "depfail"
  | "denied"
  | "success";

export const PREVIEW_STATES: readonly { key: PreviewState; label: string }[] = [
  { key: "default", label: "默认" },
  { key: "loading", label: "加载" },
  { key: "empty", label: "空" },
  { key: "invalid", label: "校验失败" },
  { key: "depfail", label: "依赖失败" },
  { key: "denied", label: "无权限" },
  { key: "success", label: "成功" },
] as const;

export type WorkStackScreen =
  | "skill-catalog"
  | "agent-directory"
  | "run-panel"
  | "gate-status"
  | "board-run";

// ---------------------------------------------------------------------------
// Skill 目录（work-skill-meta / work-eval）
// ---------------------------------------------------------------------------

export type SkillChannel = "candidate" | "verified";
export type Readiness = "ready" | "not_ready" | "unknown";
export type RiskClass = "read_only" | "external_send" | "external_write";
export type GateState = "pass" | "fail" | "not_applicable" | "not_evaluated";
export type GateId = "G0" | "G1" | "G2" | "G3" | "G4" | "G5";

export interface SkillDep {
  readonly stableId: string;
  readonly name: string;
  readonly optional: boolean;
  readonly readiness: Readiness;
  /** not_ready / unknown 时的可行动原因 */
  readonly reason?: string;
}

export interface GateCell {
  readonly gate: GateId;
  readonly state: GateState;
  readonly reason: string;
  readonly decidedAt?: string;
}

export interface SkillGateView {
  readonly cells: readonly GateCell[];
  readonly suiteId: string;
  readonly versionLabel: string;
  /** 通过数：subject vs baseline */
  readonly subjectScore: string;
  readonly baselineScore: string;
  readonly stale: boolean;
}

export interface WorkSkill {
  readonly stableId: string;
  readonly name: string;
  readonly domain: string;
  readonly channel: SkillChannel;
  readonly riskClass: RiskClass;
  readonly readiness: Readiness;
  readonly readinessMissingCount?: number;
  readonly deprecated: boolean;
  readonly summary: string;
  readonly requiredDeps: readonly SkillDep[];
  readonly optionalDeps: readonly SkillDep[];
  readonly provenance: readonly { readonly field: string; readonly value: string }[];
  readonly region: string;
  readonly jurisdiction: string;
  readonly versions: readonly { readonly label: string; readonly current: boolean; readonly note: string }[];
  readonly successor?: { readonly stableId: string; readonly name: string };
  readonly gates: SkillGateView;
}

export const RISK_LABEL: Record<RiskClass, string> = {
  read_only: "只读",
  external_send: "对外发送",
  external_write: "写入外部",
};

export const DOMAINS: readonly string[] = ["研究", "产品", "销售", "共享方法"];

function gateView(overrides?: Partial<SkillGateView>): SkillGateView {
  return {
    suiteId: "EVS-S003-intake",
    versionLabel: "1.2.0",
    subjectScore: "9/10",
    baselineScore: "6/10",
    stale: false,
    cells: [
      { gate: "G0", state: "pass", reason: "结构与 frontmatter 校验通过", decidedAt: "2026-09-20 10:12" },
      { gate: "G1", state: "pass", reason: "安全红线用例全通过", decidedAt: "2026-09-20 10:14" },
      { gate: "G2", state: "pass", reason: "核心能力 9/10 达标", decidedAt: "2026-09-21 09:03" },
      { gate: "G3", state: "pass", reason: "稳健性抽样通过", decidedAt: "2026-09-21 09:05" },
      { gate: "G4", state: "pass", reason: "成本/时延在预算内", decidedAt: "2026-09-21 09:06" },
      { gate: "G5", state: "fail", reason: "对比基线未超过阈值：9/10 vs 需 ≥ baseline+2", decidedAt: "2026-09-22 14:20" },
    ],
    ...overrides,
  };
}

export const WORK_SKILLS: readonly WorkSkill[] = [
  {
    stableId: "S003",
    name: "多源资料检索",
    domain: "研究",
    channel: "verified",
    riskClass: "read_only",
    readiness: "ready",
    deprecated: false,
    summary: "按调研主题在授权知识库与外部检索源内检索，产出带出处引用的证据清单。",
    requiredDeps: [
      { stableId: "S010", name: "风险扫描", optional: false, readiness: "ready" },
      { stableId: "S012", name: "查询扩展", optional: false, readiness: "ready" },
    ],
    optionalDeps: [
      { stableId: "S164", name: "外部网页抓取", optional: true, readiness: "not_ready", reason: "组织未授权 web.fetch 能力，检索将降级为仅知识库内检索" },
    ],
    provenance: [
      { field: "作者", value: "平台方法库团队" },
      { field: "来源包", value: "work-research@1.0.0" },
      { field: "许可", value: "内部（不可转授）" },
      { field: "评审", value: "reviews/S003.review.md · PASS" },
    ],
    region: "全球",
    jurisdiction: "无地域限制",
    versions: [
      { label: "1.2.0", current: true, note: "当前 · 补充 G4 成本预算" },
      { label: "1.1.0", current: false, note: "历史" },
    ],
    gates: gateView(),
  },
  {
    stableId: "S021",
    name: "公司信息扩充",
    domain: "销售",
    channel: "verified",
    riskClass: "external_send",
    readiness: "ready",
    deprecated: false,
    summary: "对线索所属公司并发扩充画像字段，供分层与分诊使用。",
    requiredDeps: [{ stableId: "S024", name: "线索 intake", optional: false, readiness: "ready" }],
    optionalDeps: [],
    provenance: [
      { field: "作者", value: "销售赋能团队" },
      { field: "来源包", value: "work-sales@1.0.0" },
      { field: "许可", value: "内部（不可转授）" },
      { field: "评审", value: "reviews/S021.review.md · PASS" },
    ],
    region: "全球",
    jurisdiction: "遵循目标公司所在法域",
    versions: [{ label: "1.0.0", current: true, note: "当前" }],
    gates: gateView({ subjectScore: "8/10", cells: gateView().cells.map((c) => (c.gate === "G5" ? { ...c, state: "pass", reason: "超过基线 8/10 vs 6/10" } : c)) }),
  },
  {
    stableId: "S067",
    name: "PRD 起草",
    domain: "产品",
    channel: "candidate",
    riskClass: "read_only",
    readiness: "not_ready",
    readinessMissingCount: 2,
    deprecated: false,
    summary: "从机会地图与问题定义生成结构化 PRD 草稿，供产品经理审阅。",
    requiredDeps: [
      { stableId: "S064", name: "问题定义", optional: false, readiness: "ready" },
      { stableId: "S065", name: "机会地图", optional: false, readiness: "not_ready", reason: "依赖 Skill S065 尚未通过 G2，先在评测台把 G2 跑绿" },
      { stableId: "S162", name: "指标框架", optional: false, readiness: "unknown", reason: "就绪性未知：目录服务未返回该依赖状态，可重试" },
    ],
    optionalDeps: [{ stableId: "S068", name: "优先级排序", optional: true, readiness: "ready" }],
    provenance: [
      { field: "作者", value: "产品体系团队" },
      { field: "来源包", value: "work-product@1.0.0-rc.2" },
      { field: "许可", value: "内部（不可转授）" },
      { field: "评审", value: "reviews/S067.review.md · PASS" },
    ],
    region: "全球",
    jurisdiction: "无地域限制",
    versions: [
      { label: "1.0.0-rc.2", current: true, note: "候选通道 · 待 G2/G5" },
      { label: "1.0.0-rc.1", current: false, note: "历史" },
    ],
    gates: gateView({
      subjectScore: "6/10",
      baselineScore: "6/10",
      cells: [
        { gate: "G0", state: "pass", reason: "结构与 frontmatter 校验通过" },
        { gate: "G1", state: "pass", reason: "安全红线用例全通过" },
        { gate: "G2", state: "fail", reason: "核心能力 6/10，未达 8/10 阈值" },
        { gate: "G3", state: "not_evaluated", reason: "G2 未过，未继续评测" },
        { gate: "G4", state: "not_evaluated", reason: "G2 未过，未继续评测" },
        { gate: "G5", state: "not_applicable", reason: "候选通道不参与基线对比" },
      ],
    }),
  },
  {
    stableId: "S016",
    name: "旧版摘要生成",
    domain: "研究",
    channel: "verified",
    riskClass: "read_only",
    readiness: "ready",
    deprecated: true,
    summary: "（已废弃）早期摘要 Skill，请改用后继 S020 简报生成。",
    requiredDeps: [],
    optionalDeps: [],
    provenance: [
      { field: "作者", value: "平台方法库团队" },
      { field: "来源包", value: "work-research@0.9.0" },
      { field: "许可", value: "内部（不可转授）" },
      { field: "评审", value: "reviews/S016.review.md · PASS" },
    ],
    region: "全球",
    jurisdiction: "无地域限制",
    versions: [{ label: "0.9.0", current: true, note: "已废弃" }],
    successor: { stableId: "S020", name: "简报生成" },
    gates: gateView({ stale: true }),
  },
];

// ---------------------------------------------------------------------------
// Agent 目录（agent-role）
// ---------------------------------------------------------------------------

export type RoleCategory = "research" | "product" | "design" | "sales";
export const ROLE_CATEGORY_LABEL: Record<RoleCategory, string> = {
  research: "研究",
  product: "产品",
  design: "设计",
  sales: "销售",
};

export interface OfficialAgent {
  readonly agentId: string;
  readonly code: string;
  readonly name: string;
  readonly title: string;
  readonly category: RoleCategory;
  readonly initials: string;
  readonly readiness: Readiness;
  readonly workflowCount: number;
  readonly workflowAllowlist: readonly { readonly key: string; readonly name: string }[];
  readonly skills: readonly { readonly stableId: string; readonly name: string; readonly mounted: boolean }[];
  readonly capabilities: readonly { readonly category: string; readonly readiness: Readiness }[];
}

export const OFFICIAL_AGENTS: readonly OfficialAgent[] = [
  {
    agentId: "D002",
    code: "D002",
    name: "调研员",
    title: "研究线 · 调研到简报",
    category: "research",
    initials: "研",
    readiness: "ready",
    workflowCount: 5,
    workflowAllowlist: [
      { key: "W001", name: "主题调研到简报" },
      { key: "W006", name: "证据评审" },
      { key: "W009", name: "竞品扫描" },
      { key: "W057", name: "访谈综合" },
      { key: "W060", name: "简报分发" },
    ],
    skills: [
      { stableId: "S003", name: "多源资料检索", mounted: true },
      { stableId: "S063", name: "研究综合", mounted: true },
      { stableId: "S171", name: "证据评审", mounted: true },
      { stableId: "S020", name: "简报生成", mounted: false },
    ],
    capabilities: [
      { category: "web.fetch", readiness: "ready" },
      { category: "chat.post", readiness: "ready" },
      { category: "notify.inapp", readiness: "ready" },
    ],
  },
  {
    agentId: "D003",
    code: "D003",
    name: "产品经理",
    title: "产品线 · 问题到 PRD",
    category: "product",
    initials: "品",
    readiness: "not_ready",
    workflowCount: 6,
    workflowAllowlist: [
      { key: "W027", name: "问题澄清" },
      { key: "W028", name: "机会评估" },
      { key: "W029", name: "PRD 生成" },
      { key: "W030", name: "路线图排期" },
      { key: "W031", name: "指标定义" },
      { key: "W002", name: "评审打包" },
    ],
    skills: [
      { stableId: "S064", name: "问题定义", mounted: true },
      { stableId: "S065", name: "机会地图", mounted: true },
      { stableId: "S067", name: "PRD 起草", mounted: true },
      { stableId: "S162", name: "指标框架", mounted: false },
    ],
    capabilities: [
      { category: "chat.post", readiness: "ready" },
      { category: "notify.inapp", readiness: "not_ready" },
    ],
  },
  {
    agentId: "D011",
    code: "D011",
    name: "设计研究员",
    title: "设计线 · 用户洞察",
    category: "design",
    initials: "设",
    readiness: "ready",
    workflowCount: 5,
    workflowAllowlist: [
      { key: "W027", name: "问题澄清" },
      { key: "W028", name: "机会评估" },
      { key: "W029", name: "PRD 生成" },
      { key: "W031", name: "指标定义" },
      { key: "W002", name: "评审打包" },
    ],
    skills: [
      { stableId: "S064", name: "问题定义", mounted: true },
      { stableId: "S065", name: "机会地图", mounted: true },
    ],
    capabilities: [
      { category: "chat.post", readiness: "ready" },
    ],
  },
  {
    agentId: "D005",
    code: "D005",
    name: "销售拓展",
    title: "销售线 · 线索到合格",
    category: "sales",
    initials: "销",
    readiness: "ready",
    workflowCount: 3,
    workflowAllowlist: [
      { key: "W011", name: "线索分诊到 CRM" },
      { key: "W013", name: "会后跟进" },
      { key: "W015", name: "周计划" },
    ],
    skills: [
      { stableId: "S024", name: "线索 intake", mounted: true },
      { stableId: "S021", name: "公司信息扩充", mounted: true },
      { stableId: "S022", name: "线索分层", mounted: true },
      { stableId: "S034", name: "数据卫生", mounted: true },
    ],
    capabilities: [
      { category: "crm.write", readiness: "ready" },
      { category: "mail.send", readiness: "ready" },
      { category: "notify.inapp", readiness: "ready" },
    ],
  },
];

// ---------------------------------------------------------------------------
// Workflow 运行面板（workflow-runtime）
// ---------------------------------------------------------------------------

export type StageStatus = "done" | "running" | "awaiting_gate_decision" | "rejected" | "failed" | "blocked_permission" | "pending";
export type SseStatus = "live" | "reconnecting" | "polling";

export interface RunStage {
  readonly stageId: string;
  readonly name: string;
  readonly status: StageStatus;
  readonly attempt: number;
  readonly pinnedSkills: readonly string[];
  readonly note?: string;
}

export interface RunEvent {
  readonly seq: number;
  readonly at: string;
  readonly text: string;
}

export interface ApprovalPreview {
  readonly capability: string;
  readonly targetSystem: string;
  readonly initiator: string;
  readonly agent: string;
  readonly effectSummary: string;
  readonly items: readonly string[];
}

export interface WorkflowRun {
  readonly instanceId: string;
  readonly workflowKey: string;
  readonly workflowName: string;
  readonly pinnedVersion: string;
  readonly initiatorAgent: string;
  readonly stages: readonly RunStage[];
  readonly events: readonly RunEvent[];
  readonly sse: SseStatus;
  readonly approval?: ApprovalPreview;
}

export const WORKFLOW_RUN: WorkflowRun = {
  instanceId: "run_9f2c",
  workflowKey: "W011",
  workflowName: "线索分诊到 CRM",
  pinnedVersion: "W011@2.1.0",
  initiatorAgent: "D005 销售拓展",
  sse: "live",
  stages: [
    { stageId: "admit", name: "准入校验", status: "done", attempt: 1, pinnedSkills: ["S024@1.0.0"] },
    { stageId: "intake", name: "线索 intake", status: "done", attempt: 1, pinnedSkills: ["S024@1.0.0"] },
    { stageId: "enrich", name: "公司信息扩充", status: "done", attempt: 2, pinnedSkills: ["S021@1.0.0"], note: "首次并发超时，第 2 次成功" },
    { stageId: "tier", name: "线索分层", status: "running", attempt: 1, pinnedSkills: ["S022@1.1.0"] },
    { stageId: "gate", name: "G1 线索决定门", status: "pending", attempt: 0, pinnedSkills: [] },
    { stageId: "write", name: "写入 CRM", status: "pending", attempt: 0, pinnedSkills: ["S034@1.0.0"] },
  ],
  events: [
    { seq: 1, at: "14:02:11", text: "实例创建，固定 W011@2.1.0 与 Skill 版本" },
    { seq: 2, at: "14:02:12", text: "admit 通过：发起人对 3 个来源具读权限" },
    { seq: 3, at: "14:02:40", text: "intake 完成：解析 42 条线索" },
    { seq: 4, at: "14:03:20", text: "enrich attempt 1 超时，触发重试" },
    { seq: 5, at: "14:03:58", text: "enrich attempt 2 完成：38 家公司画像补全" },
    { seq: 6, at: "14:04:10", text: "tier 运行中：按 ICP 打分…" },
  ],
};

export const APPROVAL: ApprovalPreview = {
  capability: "crm.write（写入外部）",
  targetSystem: "租户 CRM · Salesforce 生产",
  initiator: "林可（销售代表）",
  agent: "D005 销售拓展",
  effectSummary: "将 38 条合格线索写入 CRM，创建对应联系人与商机记录",
  items: [
    "Acme Corp · 新建商机（阶段：初步接触）",
    "Globex Inc · 更新联系人（乐观并发版本 v7）",
    "Initech · 新建商机（阶段：初步接触）",
  ],
};

// ---------------------------------------------------------------------------
// Board 运行投影卡（work-content）
// ---------------------------------------------------------------------------

export interface BoardRunCard {
  readonly cardId: string;
  readonly title: string;
  readonly column: "in_progress" | "review" | "done";
  readonly columnLabel: string;
  readonly statusBadge: string;
  readonly statusTone: "primary" | "warning" | "success" | "danger";
  readonly participants: readonly { readonly initials: string; readonly name: string }[];
  readonly instanceRef: string;
  readonly failed?: boolean;
}

export const BOARD_RUN_CARDS: readonly BoardRunCard[] = [
  {
    cardId: "card_run_9f2c",
    title: "线索分诊到 CRM · 由林可发起",
    column: "in_progress",
    columnLabel: "进行中",
    statusBadge: "运行中",
    statusTone: "primary",
    participants: [{ initials: "销", name: "D005 销售拓展" }],
    instanceRef: "run_9f2c",
  },
  {
    cardId: "card_run_7a10",
    title: "主题调研到简报 · 由周叙发起",
    column: "review",
    columnLabel: "待审阅",
    statusBadge: "等待审批",
    statusTone: "warning",
    participants: [
      { initials: "研", name: "D002 调研员" },
      { initials: "品", name: "D003 产品经理" },
    ],
    instanceRef: "run_7a10",
  },
  {
    cardId: "card_run_5b33",
    title: "问题到 PRD · 由郑一发起",
    column: "done",
    columnLabel: "已完成",
    statusBadge: "已完成",
    statusTone: "success",
    participants: [{ initials: "品", name: "D003 产品经理" }],
    instanceRef: "run_5b33",
  },
  {
    cardId: "card_run_2c44",
    title: "会后跟进 · 由林可发起",
    column: "done",
    columnLabel: "已完成",
    statusBadge: "失败（可重试）",
    statusTone: "danger",
    participants: [{ initials: "销", name: "D005 销售拓展" }],
    instanceRef: "run_2c44",
    failed: true,
  },
];
