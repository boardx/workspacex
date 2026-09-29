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
import { wave2Runtime } from "@repo/contracts";
import type { OfficialAgentStarterPack } from "./starter-pack";

export const OFFICIAL_AGENT_ROLE_PACK_ID = "official-digitalhuman-roles";
export const OFFICIAL_AGENT_ROLE_PACK_VERSION = "1.0.0";

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
  readonly workflowAllowlist: readonly string[];
  readonly toolPolicy: readonly string[];
  readonly instructions: string;
}

/** ⚠ `workflowAllowlist` 逐字取自矩阵——改这份清单前先改矩阵，再回来同步（同一事实单点）。 */
const ROLE_SEEDS: readonly RoleEntrySeed[] = [
  {
    roleRef: "D002",
    roleLabel: "Research & Knowledge Analyst",
    stableName: "d002-research-knowledge-analyst",
    roleCategory: "research",
    workflowAllowlist: ["W001", "W060", "W009", "W006", "W057"],
    toolPolicy: ["knowledge.search"],
    instructions: "Run structured research, cite every claim to a retrievable source, and route findings into the org knowledge base without editorializing beyond what the evidence supports.",
  },
  {
    roleRef: "D003",
    roleLabel: "Product Manager",
    stableName: "d003-product-manager",
    roleCategory: "product",
    workflowAllowlist: ["W027", "W028", "W029", "W030", "W031", "W032"],
    toolPolicy: ["knowledge.search"],
    instructions: "Turn discovery signals into prioritized problem statements and PRDs, keep the roadmap traceable to evidence, and hand off sprint-ready scope without silently narrowing it.",
  },
  {
    roleRef: "D005",
    roleLabel: "Sales Representative",
    stableName: "d005-sales-representative",
    roleCategory: "sales",
    workflowAllowlist: ["W011", "W012", "W013", "W014", "W015", "W016", "W018"],
    toolPolicy: ["crm.read"],
    instructions: "Qualify leads, run the pipeline from first meeting to close, and keep every stage change grounded in the CRM record rather than a private recollection.",
  },
  {
    roleRef: "D011",
    roleLabel: "Design Thinking Expert",
    stableName: "d011-design-thinking-expert",
    roleCategory: "design",
    workflowAllowlist: ["W027", "W028", "W029", "W031", "W002"],
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
      avatar: null,
      roleCategory: seed.roleCategory,
      workflowAllowlist: [...seed.workflowAllowlist],
      delegationPolicy: { allowedTargets: [...DEFAULT_DELEGATION_POLICY.allowedTargets], maxDepth: DEFAULT_DELEGATION_POLICY.maxDepth, requireApproval: DEFAULT_DELEGATION_POLICY.requireApproval },
      escalationPolicy: { rules: [...DEFAULT_ESCALATION_POLICY.rules] },
      kpi: [],
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
