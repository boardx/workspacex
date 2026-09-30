/**
 * AG03 / UC-3（契约束 `agent-role`，R3.3）—— 平台运营产出的官方角色包内容：D002/D003/D005/D011。
 *
 * `workflowAllowlist` 逐字取自 `requirements/work-stack-v2/DIGITALHUMAN-COMPOSITION-MATRIX.md`
 * 第 8/9/11/17 行（单一事实源 = 该矩阵；`.harness/scripts/lint-work-stack-graph.ts` 对同一份矩阵
 * 做静态图校验，本文件不复述那份校验，只搬运矩阵里 D002/D003/D005/D011 四行的 Workflow 列）：
 *   D002 Research & Knowledge Analyst → W001, W060, W009, W006, W057
 *   D003 Product Manager             → W027, W028, W029, W030, W031, W032
 *   D005 Sales Representative        → W011, W012, W013, W014, W015, W016, W018
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
 * 1.4.0：角色名/角色标签改为中文（界面不再露英文标识，UIUX 复审 2026-09-30）；已导入旧版的组织由
 * 迁移 `20260930123000_dh_official_names_zh.sql` 改名（字面量由 official-role-pack-import.test.ts 核对）。
 */
export const OFFICIAL_AGENT_ROLE_PACK_VERSION = "1.4.0";

/** Skill 起步包坐标（`skills/starter-packs/<packId>/<packVersion>.json`）。 */
export interface OfficialRoleSkillPackRef { readonly packId: string; readonly packVersion: string }
const WORK_RESEARCH: OfficialRoleSkillPackRef = { packId: "work-research", packVersion: "1.0.0" };
const WORK_PRODUCT: OfficialRoleSkillPackRef = { packId: "work-product", packVersion: "1.0.0" };

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

type UnsignedOfficialPack = z.input<typeof wave2Runtime.UnsignedOfficialAgentStarterPack>;
type UnsignedOfficialEntry = UnsignedOfficialPack["agents"][number];

const DEFAULT_DELEGATION_POLICY = { allowedTargets: [] as const, maxDepth: 0 as const, requireApproval: true as const };
const DEFAULT_ESCALATION_POLICY = { rules: [] as const };

interface RoleEntrySeed {
  readonly roleRef: string;
  readonly roleLabel: string;
  readonly stableName: string;
  readonly roleCategory: "research" | "product" | "sales" | "design" | "general";
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
  readonly toolPolicy: readonly string[];
  readonly instructions: string;
}

/** ⚠ `workflowAllowlist` 逐字取自矩阵——改这份清单前先改矩阵，再回来同步（同一事实单点）。 */
const ROLE_SEEDS: readonly RoleEntrySeed[] = [
  {
    roleRef: "D002",
    avatarKey: "dh-02-research-knowledge-analyst",
    roleLabel: "研究与知识分析师",
    stableName: "d002-research-knowledge-analyst",
    roleCategory: "research",
    tags: ["调研", "知识管理", "分析"],
    workflowAllowlist: ["W001", "W060", "W009", "W006", "W057"],
    skillPacks: [WORK_RESEARCH],
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
    toolPolicy: ["crm.read"],
    instructions: "Qualify leads, run the pipeline from first meeting to close, and keep every stage change grounded in the CRM record rather than a private recollection.",
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
      delegationPolicy: { allowedTargets: [...DEFAULT_DELEGATION_POLICY.allowedTargets], maxDepth: DEFAULT_DELEGATION_POLICY.maxDepth, requireApproval: DEFAULT_DELEGATION_POLICY.requireApproval },
      escalationPolicy: { rules: [...DEFAULT_ESCALATION_POLICY.rules] },
      kpi: [],
      tags: [...seed.tags],
    },
  };
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
