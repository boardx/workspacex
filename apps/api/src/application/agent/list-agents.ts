/**
 * `listAgents`（#1915，契约 `agentRuntime.operations.listAgents`，`GET /agents`）——
 * F55 Agent 库的第一条真实读路径。
 *
 * ## 为什么这条路径此前不存在
 *
 * `createAgent`（#617）把「新建」这条写路径接通了，但从没有任何 controller 挂载过
 * `listAgents`——`grep -rln "listAgents" apps/api/src` 在本文件之前零命中除头注引用。
 * 后果：建出来的 agent 在界面上找不到，`agent-definition-create-panel.tsx` 头注
 * 逐字写着「本屏没有把它列出来的读路径」。本文件是那条缺口的补线。
 *
 * ## 为什么授权是 admin，而不是任意组织成员
 *
 * `AgentRow.visibility` 里的「仅某组」在 phase-1 没有团队归属数据可判
 * （`agents` 表没有 `owner_team_id`/`group_id` 列——见 `20260807030000_i617_create_agent.sql`）。
 * 一个「仅某组」的 agent 在没有团队判据的情况下要么对谁都可见、要么对谁都不可见，
 * 前者直接违反契约本身「仅某组」这个词面的意思。⇒ 本轮 fail closed：只有 org admin
 * 能读这条列表（与 `createAgent`/`updateAgentDefinition`/`selfPublishToollessAgent`
 * 同一道门），不冒充一套并不存在的可见范围判定。这是已知缺口，不是遗漏——
 * 契约 `KNOWN_CONTRACT_GAPS.AR13` 记着它，解除条件是团队归属数据落地。
 *
 * ## 为什么 `tag` 过滤器不生效
 *
 * `agents` 表没有 `tag` 列（`i617`/`i1705` 两次迁移都没加）。传非 null 的 `tag` 时
 * 本用例不假装能按它过滤——那会让调用方以为自己缩小了范围，其实结果集根本没变。
 * 见 `KNOWN_CONTRACT_GAPS.AR13` 同一条：`tag` 过滤器的落地一并等团队/标签数据模型定案。
 */
import type { AgentPublishStateName, AgentVisibility } from "../../domain/agent/definition";
import type { IdentityRepository } from "../identity/ports";
import { toOrgId } from "../../domain/org-id";

export type ListAgentsErrorCode = "ROLE_INSUFFICIENT";

export class ListAgentsError extends Error {
  constructor(readonly code: ListAgentsErrorCode) {
    super(code);
    this.name = "ListAgentsError";
  }
}

/** 一行 Agent 库条目——契约 `AgentRow` 的落库投影，`monthlyCallCount` 恒为 null（D-07）。 */
export interface AgentListRow {
  readonly agentId: string;
  readonly initials: string;
  readonly name: string;
  readonly role: string;
  readonly roleLabel: string;
  readonly visibility: AgentVisibility;
  readonly publishState: AgentPublishStateName;
  readonly modelId: string | null;
  readonly skillCount: number;
}

export interface ListAgentsFilters {
  readonly publishState: AgentPublishStateName | null;
  readonly visibility: AgentVisibility | null;
}

export interface ListAgentsRepository {
  /** 只返回经 `createAgent`/`updateAgentDefinition` 那条「当前定义」路径落库的行。 */
  list(orgId: string, filters: ListAgentsFilters): Promise<readonly AgentListRow[]>;
}

export interface ListAgentsDeps {
  readonly identities: IdentityRepository;
  readonly repository: ListAgentsRepository;
}

export interface ListAgentsInput {
  readonly orgId: string;
  readonly actorId: string;
  /** 非 null 时本轮不生效（见头注「为什么 tag 过滤器不生效」）——不静默假装过滤了。 */
  readonly tag: string | null;
  readonly publishState: AgentPublishStateName | null;
  readonly visibility: AgentVisibility | null;
}

export async function listAgents(
  input: ListAgentsInput,
  deps: ListAgentsDeps,
): Promise<readonly AgentListRow[]> {
  /* ① 授权门，必须最先——同本束其余 agent-runtime 用例逐字同一条门槛。 */
  const membership = await deps.identities.findOrgMembership(input.actorId, toOrgId(input.orgId));
  if (!membership || membership.orgRole !== "admin") {
    throw new ListAgentsError("ROLE_INSUFFICIENT");
  }

  return deps.repository.list(input.orgId, {
    publishState: input.publishState,
    visibility: input.visibility,
  });
}
