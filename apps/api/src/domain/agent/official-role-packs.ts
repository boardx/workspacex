/**
 * AG03 / UC-3（契约束 `agent-role`，R3.3）—— 平台运营产出的官方角色包内容：D001/D002/D003/D005/D006/D007/D011。
 *
 * `workflowAllowlist` 逐字取自 `requirements/work-stack-v2/DIGITALHUMAN-COMPOSITION-MATRIX.md`
 * 第 7/8/9/11/12/13/17 行（单一事实源 = 该矩阵；`.harness/scripts/lint-work-stack-graph.ts` 对同一份矩阵
 * 做静态图校验，本文件不复述那份校验，只搬运矩阵里各行的 Workflow 列）：
 *   D001 Executive / Strategy Partner → W001, W004, W009, W003
 *   D002 Research & Knowledge Analyst → W001, W060, W009, W006, W057
 *   D003 Product Manager             → W027, W028, W029, W030, W031, W032
 *   D005 Sales Representative        → W011, W012, W013, W014, W015, W016, W018
 *   D006 Customer Success Specialist → W007, W017, W018, W002, W006（⚠ 首版有意不含 W017，见 D006 种子）
 *   D007 Project / Operations Manager → W052, W053, W055, W056, W002, W003
 *   D011 Design Thinking Expert      → W027, W028, W029, W031, W002
 *
 * `skillVersions`（直接挂载）本轮留空：矩阵里的 Skill 列（S003/S063/… 等）属于 Work Skill 目录
 * （`work-skill-meta` 契约束，WS01–WS05），这条目录本身在本仓库尚未落地为可导入的 skill_versions
 * 行——挂载会在那条目录落地后随包版本升级一起补上，不在本轮编造一份对不上目录的假引用
 * （AGENTS.md「静态痕迹 ≠ 动态事实」）。`toolPolicy` 与 `workflowAllowlist` 不受这个限制：前者只是
 * 能力分类声明（ADR-120 #2，不产生授权），后者由 Workflow Runtime 的注册表校验，与 Skill 目录
 * 落地与否无关。
 *
 * 本文件只产出**未签名**的角色包内容；`packDigest`/`instructionDigest` 由
 * `buildOfficialAgentRolePack()` 过一遍契约 schema 的 `.parse()` 之后再算——`.parse()` 把每层
 * 对象的键序规范成 schema 声明顺序，后续任何一次重新校验（`verifyOfficialAgentStarterPack`）算出
 * 的 `unsigned` JSON 与这里算出来的逐字节相同，摘要因此总能对上（不用手工追踪 JSON 键序）。
 */
import { createHash } from "node:crypto";
import type { z } from "zod";
import { agentRole, wave2Runtime } from "@repo/contracts";
import type { OfficialAgentStarterPack } from "./starter-pack";

export const OFFICIAL_AGENT_ROLE_PACK_ID = "official-digitalhuman-roles";
/** 1.1.0：四个官方角色挂上数字人肖像头像（`avatarKey`）；1.0.0 的 avatar 恒为 null。 */
/** 1.2.0：四个官方角色带上中文标签（`tags`，目录/聊天选人按它筛选）。 */
/**
 * 1.3.0（AG07）：四个官方角色带上真实转交目标（`delegationPolicy`，见 `officialRoleDelegationTargets`），
 * 以及真实升级规则（`escalationPolicy`，见 `officialRoleEscalationRules`；此前恒为空，AG06 升级在产品里不可达）。
 */
/**
 * 1.4.0：角色名/角色标签改为中文（界面不再露英文标识，UIUX 复审 2026-09-30）；已导入旧版的组织由
 * 迁移 `20260930123000_dh_official_names_zh.sql` 改名（字面量由 official-role-pack-import.test.ts 核对）。
 */
/**
 * 1.5.0：新增 D001 高管与战略伙伴 / D006 客户成功专员 / D007 项目与运营经理三个官方角色（Skill 起步包
 * work-executive / work-customer-success / work-operations / work-engineering / work-resolution 随之进入一键启用）；
 * 既有四个角色的转交目标随 `officialRoleDelegationTargets()` 推导变化，由迁移
 * `20260930140000_rp_b2_official_delegation_targets.sql` 回填（旧值 → 新值，只动仍是旧默认值的行）。
 */
export const OFFICIAL_AGENT_ROLE_PACK_VERSION = "1.5.0";

/** Skill 起步包坐标（`skills/starter-packs/<packId>/<packVersion>.json`）。 */
export interface OfficialRoleSkillPackRef { readonly packId: string; readonly packVersion: string }
const WORK_RESEARCH: OfficialRoleSkillPackRef = { packId: "work-research", packVersion: "1.0.0" };
const WORK_PRODUCT: OfficialRoleSkillPackRef = { packId: "work-product", packVersion: "1.0.0" };
const WORK_EXECUTIVE: OfficialRoleSkillPackRef = { packId: "work-executive", packVersion: "1.0.0" };
const WORK_CUSTOMER_SUCCESS: OfficialRoleSkillPackRef = { packId: "work-customer-success", packVersion: "1.0.0" };
const WORK_OPERATIONS: OfficialRoleSkillPackRef = { packId: "work-operations", packVersion: "1.0.0" };
const WORK_ENGINEERING: OfficialRoleSkillPackRef = { packId: "work-engineering", packVersion: "1.0.0" };
const WORK_RESOLUTION: OfficialRoleSkillPackRef = { packId: "work-resolution", packVersion: "1.0.0" };

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

type UnsignedOfficialPack = z.input<typeof wave2Runtime.UnsignedOfficialAgentStarterPack>;
type UnsignedOfficialEntry = UnsignedOfficialPack["agents"][number];

const DEFAULT_DELEGATION_POLICY = { allowedTargets: [] as const, maxDepth: 0 as const, requireApproval: true as const };

type EscalationRule = z.infer<typeof agentRole.EscalationPolicy>["rules"][number];

/**
 * AG06 升级事项（`matter` 与 Agent 调 `escalate_matter` 时报的事项名**精确匹配**）。
 * 目标只用 requester / org_admin：project_owner 在项目外的私聊里解析不出任何人（fail closed，卡片无人可裁决），
 * 官方角色默认不该把升级送进死胡同。
 */
export const OFFICIAL_ESCALATION_MATTERS = {
  /** 超出本角色职责的请求 → 交还发起人决定怎么办（loopback 替身 `LOOPBACK_ESCALATE_MATTER` 的缺省值即此名）。 */
  outOfScope: "超出职责范围的事项",
  dataDeletion: "删除或覆盖组织数据",
  externalCommitment: "代表组织对客户或外部作出承诺",
  pricing: "报价、折扣或价格承诺",
  contractTerms: "合同或交付条款承诺",
  budget: "预算或资源投入承诺",
  sensitiveData: "使用含个人信息或来源未授权的数据",
  /** D001：披露未公开信息 → org_admin（D001 无任何外发能力，只做提示）。 */
  nonPublicDisclosure: "披露未公开信息",
  /** D001：董事会/监管材料的定稿是人的动作 → 交还发起人。 */
  boardOrRegulatorFinalization: "对董事会或监管的材料定稿",
  /** D006：退款、补偿、服务抵扣均属商务承诺，须有授权来源。 */
  refundOrCompensation: "退款、补偿或服务抵扣承诺",
  /** D006：安全/数据泄露类只做快速升级提示。 */
  securityOrDataLeak: "疑似安全或数据泄露事件",
  /** D007：已批准基线只能经变更请求修改 → 交还发起人走变更。 */
  approvedBaselineEdit: "直接修改已批准的项目基线",
  /** D007：事件严重度宣布与对外通报是人（事件指挥官/法务）的动作。 */
  incidentSeverityOrNotice: "宣布事件严重度或对外通报事件",
} as const;

const M = OFFICIAL_ESCALATION_MATTERS;
const COMMON_ESCALATION_RULES: readonly EscalationRule[] = [
  { matter: M.outOfScope, target: "requester" },
  { matter: M.dataDeletion, target: "org_admin" },
  { matter: M.externalCommitment, target: "org_admin" },
];

interface RoleEntrySeed {
  readonly roleRef: string;
  readonly roleLabel: string;
  readonly stableName: string;
  readonly roleCategory: z.infer<typeof agentRole.AgentRoleCategory>;
  /**
   * 数字人肖像（`DIGITAL_HUMAN_AVATAR_KEYS`，60 格角色头像网格按角色名一一对应）。
   * 「哪个官方角色用哪张肖像」只在这里声明；已导入 1.0.0 的组织由迁移
   * `20260929150000_dh_portrait_avatars.sql` 回填（其字面量由 official-role-pack-import.test.ts 与本表核对）。
   */
  readonly avatarKey: z.infer<typeof agentRole.AgentAvatar>["key"];
  /**
   * 数字人标签（契约 `AgentTags`）。已导入旧版包的组织由迁移 `20260929160000_agent_tags.sql`
   * 回填（其字面量由 official-role-pack-import.test.ts 与本表核对）。
   */
  readonly tags: readonly string[];
  readonly workflowAllowlist: readonly string[];
  /**
   * 该角色白名单里的 Workflow 引用的 Skill 所在起步包。一键启用先导入它们（既有 UC-WC-I2 导入 +
   * 导入后发布内置 Workflow 的 follow-up），角色才「启用即可用」，而不是空有白名单、一个都发不起来。
   */
  readonly skillPacks: readonly OfficialRoleSkillPackRef[];
  /** 本角色专属的升级规则（叠加在 `COMMON_ESCALATION_RULES` 之后）。 */
  readonly escalationRules: readonly EscalationRule[];
  readonly toolPolicy: readonly string[];
  /** KPI 声明（只声明不计算；契约 `AgentKpi`）。缺省 = 空（D002/D003/D005/D011 沿用 1.x 的空 KPI）。 */
  readonly kpi?: readonly z.infer<typeof agentRole.AgentKpi>[];
  readonly instructions: string;
}

/** ⚠ `workflowAllowlist` 逐字取自矩阵——改这份清单前先改矩阵，再回来同步（同一事实单点）。 */
const ROLE_SEEDS: readonly RoleEntrySeed[] = [
  {
    roleRef: "D001",
    avatarKey: "dh-01-executive-strategy-partner",
    roleLabel: "高管与战略伙伴",
    stableName: "d001-executive-strategy-partner",
    roleCategory: "executive",
    tags: ["战略", "高管", "决策"],
    workflowAllowlist: ["W001", "W004", "W009", "W003"],
    // W001/W009 的 Skill 在研究包，W003/W004 在运营/产品/高管包（矩阵第 7 行；S154/S143 → operations，S197 → executive）。
    skillPacks: [WORK_RESEARCH, WORK_PRODUCT, WORK_OPERATIONS, WORK_EXECUTIVE],
    escalationRules: [
      { matter: M.sensitiveData, target: "org_admin" },
      { matter: M.budget, target: "org_admin" },
      { matter: M.nonPublicDisclosure, target: "org_admin" },
      { matter: M.boardOrRegulatorFinalization, target: "requester" },
    ],
    toolPolicy: ["knowledge.search"],
    kpi: [
      { metric: "d001.decision_ready_rate", description: "发给决定人的决策/执行材料中，决定人首次阅读后无需退回补充信息即作出选定的比例（目标 ≥ 70%）" },
      { metric: "d001.overclaim_rate", description: "抽检中措辞强于证据允许程度、或混入未标注个人判断的句子比例（目标 ≤ 1%）" },
      { metric: "d001.triage_hit_rate", description: "用户未改选路径、且流程未以选错流程终止的比例（目标 ≥ 85%）" },
      { metric: "d001.digest_on_time", description: "高管周报在配置时刻前进入首道人工确认的比例（目标 ≥ 95%，仅统计不缺源的周）" },
      { metric: "d001.decision_log_coverage", description: "有可证决定人的已确认决定，7 天内被决定人确认记账的比例（目标 ≥ 80%）" },
      { metric: "d001.false_proactive_rate", description: "主动发言后被与会者判定为无关或已知的比例（目标 ≤ 10%）" },
      { metric: "d001.confidentiality_violations", description: "机密材料在不具权限的在场者面前被口述或展示的次数（硬门，目标 0）" },
    ],
    instructions: "Frame decisions for the decision-maker with options, evidence, confidence and the cost of not deciding; never decide, approve or announce on their behalf, propose decision-log entries only with a verifiable decision owner, and keep wording within what the evidence allows.",
  },
  {
    roleRef: "D002",
    avatarKey: "dh-02-research-knowledge-analyst",
    roleLabel: "研究与知识分析师",
    stableName: "d002-research-knowledge-analyst",
    roleCategory: "research",
    tags: ["调研", "知识管理", "分析"],
    workflowAllowlist: ["W001", "W060", "W009", "W006", "W057"],
    skillPacks: [WORK_RESEARCH],
    escalationRules: [{ matter: M.sensitiveData, target: "org_admin" }],
    toolPolicy: ["knowledge.search"],
    instructions: "Run structured research, cite every claim to a retrievable source, and route findings into the org knowledge base without editorializing beyond what the evidence supports.",
  },
  {
    roleRef: "D003",
    avatarKey: "dh-03-product-manager",
    roleLabel: "产品经理",
    stableName: "d003-product-manager",
    roleCategory: "product",
    tags: ["产品", "需求", "规划"],
    workflowAllowlist: ["W027", "W028", "W029", "W030", "W031", "W032"],
    skillPacks: [WORK_PRODUCT],
    escalationRules: [{ matter: M.budget, target: "org_admin" }],
    toolPolicy: ["knowledge.search"],
    instructions: "Turn discovery signals into prioritized problem statements and PRDs, keep the roadmap traceable to evidence, and hand off sprint-ready scope without silently narrowing it.",
  },
  {
    roleRef: "D005",
    avatarKey: "dh-05-sales-representative",
    roleLabel: "销售代表",
    stableName: "d005-sales-representative",
    roleCategory: "sales",
    tags: ["销售", "客户", "商机"],
    workflowAllowlist: ["W011", "W012", "W013", "W014", "W015", "W016", "W018"],
    // 销售线 Workflow（W011–W018）尚无运行时图（`create-workflow-runtime.ts` 只装配产品线 + 研究线），
    // 导入 work-sales 也发布不出任何可发起流程——不假装「启用即可用」，销售线运行时落地后再挂。
    skillPacks: [],
    escalationRules: [{ matter: M.pricing, target: "org_admin" }, { matter: M.contractTerms, target: "org_admin" }],
    toolPolicy: ["crm.read"],
    instructions: "Qualify leads, run the pipeline from first meeting to close, and keep every stage change grounded in the CRM record rather than a private recollection.",
  },
  {
    roleRef: "D006",
    avatarKey: "dh-06-customer-success-specialist",
    roleLabel: "客户成功专员",
    stableName: "d006-customer-success-specialist",
    roleCategory: "customer_success",
    tags: ["客户成功", "续约", "支持"],
    // ⚠ 与矩阵第 12 行（W007, W017, W018, W002, W006）有意相差 W017：W017（续约风险复核）deferred，
    // 首版白名单不含它；上线前置条件满足后以新包版本加入（见 workflows/W017-renewal-risk-review.md §2A）。
    workflowAllowlist: ["W007", "W018", "W002", "W006"],
    // W007 → customer-success + resolution；W002 → product；W006 → research。W018 是销售线，
    // 销售线运行时未随一键启用装配（同 D005），不挂 work-sales——不假装「启用即可用」。
    skillPacks: [WORK_CUSTOMER_SUCCESS, WORK_RESOLUTION, WORK_PRODUCT, WORK_RESEARCH],
    escalationRules: [
      { matter: M.pricing, target: "org_admin" },
      { matter: M.contractTerms, target: "org_admin" },
      { matter: M.sensitiveData, target: "org_admin" },
      { matter: M.refundOrCompensation, target: "org_admin" },
      { matter: M.securityOrDataLeak, target: "org_admin" },
    ],
    toolPolicy: ["knowledge.search"],
    kpi: [
      { metric: "d006.first_response_within_sla", description: "参与的工单中，首次经人批准的回复在首响时限之前发出的比例（目标 ≥ 90%，仅统计接入工单系统的实例）" },
      { metric: "d006.priority_override_rate", description: "工单优先级被人在分诊确认时改动的比例（记录基线，不设目标）" },
      { metric: "d006.reply_heavy_edit_rate", description: "回复草稿在人工确认时被改写超过一半的比例（目标 ≤ 25%）" },
      { metric: "d006.unsourced_commitment_rate", description: "对客草稿中没有授权来源的承诺句占比（硬门，目标 0）" },
      { metric: "d006.escalation_pack_completeness", description: "接收方收到升级简报后无需回头向客户成功经理或客户补问的比例（目标 ≥ 80%）" },
      { metric: "d006.false_green_rate", description: "被判健康但 30 天内出现不续约通知或最高优先级升级的账户比例（目标 ≤ 5%）" },
      { metric: "d006.kb_acceptance_rate", description: "知识文章草稿经人工确认被采纳而非废弃的比例（目标 ≥ 60%）" },
      { metric: "d006.customer_visible_violations", description: "对客草稿中出现内部标识、他客户信息或未批准路线图的次数（硬门，目标 0）" },
    ],
    instructions: "Triage customer issues, draft replies and escalation briefs for a human to send, and explain account health with its evidence gaps; every customer-facing sentence stays a draft and no commitment about price, compensation or delivery is made without an authorized source.",
  },
  {
    roleRef: "D007",
    avatarKey: "dh-07-project-operations-manager",
    roleLabel: "项目与运营经理",
    stableName: "d007-project-operations-manager",
    roleCategory: "operations",
    tags: ["项目管理", "运营", "PMO"],
    workflowAllowlist: ["W052", "W053", "W055", "W056", "W002", "W003"],
    // W052/W053/W003/W055 的 Skill 在运营包（S141–S156）+ 产品包（S142/S155/S162/S018/S006/S007）+ 研究包（S010/S012/S016）；
    // W056 的 S177/S179 在运营包与工程包，S011 在 resolution 包。
    skillPacks: [WORK_OPERATIONS, WORK_ENGINEERING, WORK_RESOLUTION, WORK_PRODUCT, WORK_RESEARCH],
    escalationRules: [
      { matter: M.budget, target: "org_admin" },
      { matter: M.sensitiveData, target: "org_admin" },
      { matter: M.approvedBaselineEdit, target: "requester" },
      { matter: M.incidentSeverityOrNotice, target: "org_admin" },
    ],
    toolPolicy: ["knowledge.search"],
    kpi: [
      { metric: "d007.intake_to_decision_days", description: "请求进入到立项受理决定的中位工作日，不含人工等待（记录基线，不设目标）" },
      { metric: "d007.projects_started_with_baseline", description: "启动的项目中拥有人工批准基线的比例（硬门，目标 100%）" },
      { metric: "d007.unapproved_scope_growth", description: "有基线的项目中出现未经批准的范围新增的项目比例（目标 ≤ 10%，趋势下降）" },
      { metric: "d007.pmo_review_on_time", description: "周度项目组合复核在周期内发布的比例（目标 ≥ 90%）" },
      { metric: "d007.stale_card_ratio", description: "项目组合中陈旧卡片占比（记录基线，趋势下降）" },
      { metric: "d007.action_closure_rate", description: "复盘与流程改进的行动项在到期日前完成的比例（目标 ≥ 70%，需人标记且有验证证据）" },
      { metric: "d007.capacity_conflicts_caught_pre_start", description: "启动前发现的容量不足或瓶颈，与启动后期才出现的超配之比（记录基线）" },
      { metric: "d007.green_wash_attempts_blocked", description: "被拒绝的改色或洗绿请求数（观察指标，无目标）" },
      { metric: "d007.unauthorized_board_writes", description: "未经用户或人工门确认的看板写入次数（硬门，目标 0）" },
    ],
    instructions: "Turn requests into bounded, baselined projects, track deviation against the approved baseline each week, convert meeting commitments into owned cards, and never approve, re-baseline, recolor status or assess individuals; every approval stays a human gate.",
  },
  {
    roleRef: "D011",
    avatarKey: "dh-11-design-thinking-expert",
    roleLabel: "设计思维专家",
    stableName: "d011-design-thinking-expert",
    roleCategory: "design",
    tags: ["设计", "创新", "用户研究"],
    workflowAllowlist: ["W027", "W028", "W029", "W031", "W002"],
    skillPacks: [WORK_PRODUCT],
    escalationRules: [{ matter: M.budget, target: "org_admin" }, { matter: M.sensitiveData, target: "org_admin" }],
    toolPolicy: ["knowledge.search"],
    instructions: "Facilitate discovery-to-opportunity and experiment loops, keep divergent options visible until a decision is made, and record the rationale next to the chosen option.",
  },
];

function buildUnsignedEntry(seed: RoleEntrySeed): UnsignedOfficialEntry {
  return {
    stableName: seed.stableName,
    name: seed.roleLabel,
    semanticVersion: OFFICIAL_AGENT_ROLE_PACK_VERSION,
    instructions: seed.instructions,
    instructionDigest: sha256(seed.instructions),
    skillVersions: [],
    modelProvider: "dashscope",
    modelId: "qwen-plus",
    toolPolicy: [...seed.toolPolicy],
    roleRef: seed.roleRef,
    roleLabel: seed.roleLabel,
    role: {
      avatar: { kind: "illustration", key: seed.avatarKey, alt: seed.roleLabel },
      roleCategory: seed.roleCategory,
      workflowAllowlist: [...seed.workflowAllowlist],
      delegationPolicy: officialRoleDelegationPolicy(seed.roleRef),
      escalationPolicy: officialRoleEscalationPolicy(seed),
      kpi: (seed.kpi ?? []).map((k) => ({ ...k })),
      tags: [...seed.tags],
    },
  };
}

/** AG07 官方角色的转交深度：只允许一跳（转交出去的线程里不再继续转交）。 */
export const OFFICIAL_ROLE_DELEGATION_MAX_DEPTH = 1;

/**
 * AG07 —— 官方角色 → 可转交目标（同一份 ROLE_SEEDS 的 workflowAllowlist 推导，不另立清单）：
 * 目标 = 拥有「本角色白名单外的某个 Workflow」的其它官方角色——与 AG05 拒绝文案里的
 * 「可转交给角色：…」是同一个判据（谁能跑我跑不了的流程，就能接我转交的活）。
 */
export function officialRoleDelegationTargets(): Readonly<Record<string, readonly string[]>> {
  return Object.fromEntries(ROLE_SEEDS.map((self) => {
    const mine = new Set(self.workflowAllowlist);
    const targets = ROLE_SEEDS
      .filter((other) => other.roleRef !== self.roleRef && other.workflowAllowlist.some((w) => !mine.has(w)))
      .map((other) => other.roleRef);
    return [self.roleRef, targets];
  }));
}

function officialRoleDelegationPolicy(roleRef: string) {
  return {
    allowedTargets: [...(officialRoleDelegationTargets()[roleRef] ?? DEFAULT_DELEGATION_POLICY.allowedTargets)],
    maxDepth: OFFICIAL_ROLE_DELEGATION_MAX_DEPTH,
    requireApproval: DEFAULT_DELEGATION_POLICY.requireApproval,
  };
}

function officialRoleEscalationPolicy(seed: RoleEntrySeed): z.infer<typeof agentRole.EscalationPolicy> {
  return { rules: [...COMMON_ESCALATION_RULES, ...seed.escalationRules].map((r) => ({ ...r })) };
}

/** 官方角色 stableName → escalationPolicy（同一份 ROLE_SEEDS；供升级规则回填迁移的核对测试使用，不另立副本）。 */
export function officialRoleEscalationPolicies(): Readonly<Record<string, z.infer<typeof agentRole.EscalationPolicy>>> {
  return Object.fromEntries(ROLE_SEEDS.map((s) => [s.stableName, officialRoleEscalationPolicy(s)]));
}

/** 供 `FileAgentStarterPackSource` 加载路径测试与真实种子共用的已签名官方角色包。 */
export function buildOfficialAgentRolePack(
  seeds: readonly RoleEntrySeed[] = ROLE_SEEDS,
): OfficialAgentStarterPack {
  const unsignedRaw: UnsignedOfficialPack = {
    schemaVersion: 1,
    packId: OFFICIAL_AGENT_ROLE_PACK_ID,
    packVersion: OFFICIAL_AGENT_ROLE_PACK_VERSION,
    agents: seeds.map(buildUnsignedEntry),
  };
  const unsigned = wave2Runtime.UnsignedOfficialAgentStarterPack.parse(unsignedRaw);
  const packDigest = sha256(JSON.stringify(unsigned));
  return wave2Runtime.OfficialAgentStarterPack.parse({ ...unsigned, packDigest });
}

/**
 * CT06（E3）—— 官方角色 → `workflowAllowlist`（同一份 ROLE_SEEDS，不另立副本）。
 * 白名单外发起时据此给出「可转交」的官方角色（例：W030 → D003）。
 */
export function officialRoleWorkflowAllowlists(): Readonly<Record<string, readonly string[]>> {
  return Object.fromEntries(ROLE_SEEDS.map((s) => [s.roleRef, [...s.workflowAllowlist]]));
}

/** 官方角色 stableName → 肖像 key（同一份 ROLE_SEEDS；供回填迁移的核对测试使用，不另立副本）。 */
export function officialRoleAvatarKeys(): Readonly<Record<string, string>> {
  return Object.fromEntries(ROLE_SEEDS.map((s) => [s.stableName, s.avatarKey]));
}

/** 一键启用须先导入的 Skill 起步包（全部官方角色所需的并集，去重、保持声明顺序；同一份 ROLE_SEEDS）。 */
export function officialRoleSkillPacks(): readonly OfficialRoleSkillPackRef[] {
  const seen = new Map<string, OfficialRoleSkillPackRef>();
  for (const s of ROLE_SEEDS) for (const p of s.skillPacks) seen.set(`${p.packId}@${p.packVersion}`, p);
  return [...seen.values()];
}

/** 官方角色 stableName → 中文名（同一份 ROLE_SEEDS；供改名迁移的核对测试使用）。 */
export function officialRoleNames(): Readonly<Record<string, string>> {
  return Object.fromEntries(ROLE_SEEDS.map((s) => [s.stableName, s.roleLabel]));
}

/** 官方角色 stableName → 标签（同一份 ROLE_SEEDS；供标签回填迁移的核对测试使用，不另立副本）。 */
export function officialRoleTags(): Readonly<Record<string, readonly string[]>> {
  return Object.fromEntries(ROLE_SEEDS.map((s) => [s.stableName, [...s.tags]]));
}
