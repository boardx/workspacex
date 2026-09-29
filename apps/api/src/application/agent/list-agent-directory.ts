/**
 * AG04 / UC-4（契约束 `agent-role`，`listAgentDirectory` / `getAgentDirectoryCard`）——
 * 成员 Agent 目录：按 `roleCategory` 分组的官方角色卡片。
 *
 * ## 可见范围（同 `list-agents.ts` 头注「为什么授权是…」同一条已知缺口 AR13）
 *
 * `agents` 表没有团队归属列，「仅某组」可见性在 phase-1 判不了。目录是**成员**入口
 * （不像 `listAgents` 那样退化成 admin-only），所以这里走另一条 fail-closed 规则：
 * 只列 `capability_listings.scope='org-wide'` 且 `enabled` 的行——「仅某组」的 Agent
 * 对任何成员都不出现在目录里（不是「先列出来再判权限」，是查询本身就不选它们），直到团队
 * 归属数据落地。
 *
 * ## 就绪状态（`readiness`）为什么只有两档在这一轮能算
 *
 * 契约 `CapabilityReadiness` 有三档（ready/missing/unknown）。真正的「这个分类有没有被
 * 管理员授权」需要能力分类 × 已授权工具的授权表（`work-skill-meta` 契约束 WS04 的地基），
 * 这张表本轮（AG04）尚未落地到这条分支——不在这里假查一张不存在的表来编造 ready/missing
 * 的区分（AGENTS.md「静态痕迹 ≠ 动态事实」：没有地基就不能假装读出了地基上的结果）。
 * 所以本轮诚实地退化：`toolPolicy` 为空 ⇒ 不需要任何能力 ⇒ `ready`；非空 ⇒ 无法判定
 * ⇒ `unknown`（契约里「授权查询失败 → unknown，不整页报错」的合法状态，这里是「查询能力
 * 尚不存在」的等价情形）。WS04 落地后换成真实分类比对，调用方（本文件）的形状不用跟着改。
 */
import type { AgentRoleFieldsT } from "../../domain/agent/definition";
import type { IdentityRepository } from "../identity/ports";
import type { OrgId } from "../../domain/org-id";
import type { WorkflowDefinitionStore } from "../agent-import/ports";

type AgentRoleCategory = AgentRoleFieldsT["roleCategory"];
type AgentCatalogSource = AgentRoleFieldsT["catalogSource"];
type AgentAvatar = AgentRoleFieldsT["avatar"];

export type AgentDirectoryErrorCode = "UNAUTHENTICATED" | "AGENT_NOT_FOUND";
export class AgentDirectoryError extends Error {
  constructor(readonly code: AgentDirectoryErrorCode) { super(code); this.name = "AgentDirectoryError"; }
}

/** 一行「已发布且组织可见」的 Agent 投影——落库形状，不是契约 DTO（后者在用例里拼）。 */
export interface AgentDirectoryRow {
  readonly agentId: string;
  readonly versionId: string;
  readonly name: string;
  readonly roleLabel: string;
  readonly avatar: AgentAvatar | null;
  readonly roleCategory: AgentRoleCategory | null;
  readonly catalogSource: AgentCatalogSource;
  readonly workflowAllowlist: readonly string[];
  /** 只用长度判 ready/unknown（见文件头「就绪状态」）；不外泄具体分类内容。 */
  readonly toolPolicyLength: number;
}

export interface AgentDirectoryRepository {
  /** 只返回 `roleCategory` 非空、`org-wide` 可见、已发布、启用中的行。 */
  listVisible(orgId: OrgId): Promise<readonly AgentDirectoryRow[]>;
  findVisible(orgId: OrgId, agentId: string): Promise<AgentDirectoryRow | null>;
}
export const AGENT_DIRECTORY_REPOSITORY = Symbol("AgentDirectoryRepository");

export interface AgentDirectoryCardOut {
  readonly agentId: string;
  readonly versionId: string;
  readonly name: string;
  readonly initials: string;
  readonly roleLabel: string;
  readonly avatar: AgentAvatar | null;
  readonly roleCategory: AgentRoleCategory | null;
  readonly catalogSource: AgentCatalogSource;
  readonly workflows: readonly { readonly stableId: string; readonly name: string }[];
  readonly readiness: "ready" | "missing" | "unknown";
}

/** A3：`initials` 永远由 `name` 首字符派生，不依赖可能为空的落库列（官方导入行没有单独存 initials）。 */
function initialsOf(name: string): string {
  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed[0]!.toUpperCase() : "?";
}

function readinessOf(row: AgentDirectoryRow): "ready" | "unknown" {
  return row.toolPolicyLength === 0 ? "ready" : "unknown";
}

async function toCard(
  row: AgentDirectoryRow,
  workflows: WorkflowDefinitionStore,
): Promise<AgentDirectoryCardOut> {
  const resolvedWorkflows = await Promise.all(
    row.workflowAllowlist.map(async (stableId) => ({
      stableId,
      name: (await workflows.resolveName(stableId).catch(() => null)) ?? stableId,
    })),
  );
  return {
    agentId: row.agentId,
    versionId: row.versionId,
    name: row.name,
    initials: initialsOf(row.name),
    roleLabel: row.roleLabel,
    avatar: row.avatar,
    roleCategory: row.roleCategory,
    catalogSource: row.catalogSource,
    workflows: resolvedWorkflows,
    readiness: readinessOf(row),
  };
}

export interface AgentDirectoryDeps {
  readonly identities: IdentityRepository;
  readonly repository: AgentDirectoryRepository;
  readonly workflows: WorkflowDefinitionStore;
}

export async function listAgentDirectory(
  input: { readonly orgId: OrgId; readonly actorId: string; readonly roleCategory: AgentRoleCategory | null; readonly q: string | null },
  deps: AgentDirectoryDeps,
): Promise<readonly AgentDirectoryCardOut[]> {
  const membership = await deps.identities.findOrgMembership(input.actorId, input.orgId);
  if (!membership) throw new AgentDirectoryError("UNAUTHENTICATED");

  const rows = await deps.repository.listVisible(input.orgId);
  const q = input.q?.trim().toLowerCase() ?? "";
  const filtered = rows.filter((row) => {
    if (input.roleCategory !== null && row.roleCategory !== input.roleCategory) return false;
    if (q.length > 0 && !`${row.name}${row.roleLabel}`.toLowerCase().includes(q)) return false;
    return true;
  });
  return Promise.all(filtered.map((row) => toCard(row, deps.workflows)));
}

export async function getAgentDirectoryCard(
  input: { readonly orgId: OrgId; readonly actorId: string; readonly agentId: string },
  deps: AgentDirectoryDeps,
): Promise<AgentDirectoryCardOut> {
  const membership = await deps.identities.findOrgMembership(input.actorId, input.orgId);
  if (!membership) throw new AgentDirectoryError("UNAUTHENTICATED");

  // E9：不存在 / 跨组织 / 不在 org-wide 可见范围内 —— 一律 404，不泄露存在性。
  const row = await deps.repository.findVisible(input.orgId, input.agentId);
  if (row === null) throw new AgentDirectoryError("AGENT_NOT_FOUND");
  return toCard(row, deps.workflows);
}
