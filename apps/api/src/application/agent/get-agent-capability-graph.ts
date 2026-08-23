/**
 * `getAgentCapabilityGraph`（#1911，契约 `agent-runtime.ts` `getAgentCapabilityGraph`）。
 *
 * ## 为什么没有新仓储文件（但有新仓储方法——#1918 hotfix，#1923）
 *
 * 2026-08-23 devapp 实测发现：本用例最初复用 `CreateAgentRepository.findForClone`
 * （`pg-create-agent-repository.ts` 的 `toDefinition()`）读能力图，而 `toDefinition()`
 * 刻意把 `initials`/`role`/`visibility`/`source`/`publish_state`/`concurrency_limit`/
 * `degrade_policy` 七列任一为 NULL 的行当作「不存在」——这条判据对「能不能当克隆源」
 * 是对的，但对「能力图只读展示」是错的：**能不能克隆**和**这个 agent 存不存在、
 * 挂了什么能力**是两个不同的问题。由 agent-starter-import 或 #662 迁移
 * （`default-agent-backfill.test.ts`）补种出来的默认 agent（如每个组织的「通用助手」，
 * 每个组织最常用、最重要的默认 agent）这七列天然为 NULL，此前对它们能力图必然 404。
 *
 * 修复：新增 `CreateAgentRepository.findForCapabilityGraph`，一条**专属**的只读路径，
 * 不复用 `findForClone`/`toDefinition` 的七列判据，只要求能力图真正需要的字段
 * （`id`/`org_id`/`name`/`role_label`/`skill_mounts`/`tool_whitelist`）存在。
 * ⚠ 没有新建仓储文件——同一张表、同一条 `pg-create-agent-repository.ts`，
 * 只是多一个方法；`findForClone`/`toDefinition` 本身**未改动**，克隆功能的
 * 判据保持不变（放宽它会让克隆开始尝试克隆残缺行，制造新 bug）。
 *
 * ## 为什么不额外做 ROLE_INSUFFICIENT 门
 *
 * 这是一条只读操作，读的是同一个 org 内已发布/在建的 agent 的挂载配置——与
 * `/admin/agent/[id]` 详情页本身的可见范围相同（该路由已在导航层限定为 org 内
 * 已登录用户可达）。写操作（`setAgentSkillPins`/`setToolWhitelist`）才需要 admin
 * 门，读一个已经在界面上看得到的 agent 挂了什么不需要再加一层。
 */
import type { AgentCapabilityGraphRow } from "./create-agent";

export type GetAgentCapabilityGraphErrorCode = "AGENT_NOT_FOUND";

export class GetAgentCapabilityGraphError extends Error {
  constructor(readonly code: GetAgentCapabilityGraphErrorCode) {
    super(code);
    this.name = "GetAgentCapabilityGraphError";
  }
}

export interface GetAgentCapabilityGraphRepository {
  /**
   * #1918 hotfix（#1923）—— 与 `findForClone` 不是同一条读路径：本方法不要求
   * `createAgent` 那七列非空，补种/starter-import 产生的残缺行也能读出能力图。
   */
  findForCapabilityGraph(orgId: string, agentId: string): Promise<AgentCapabilityGraphRow | null>;
}

export interface GetAgentCapabilityGraphResult {
  readonly agentId: string;
  readonly name: string;
  readonly roleLabel: string;
  readonly skillMounts: AgentCapabilityGraphRow["skillMounts"];
  readonly toolWhitelist: AgentCapabilityGraphRow["toolWhitelist"];
}

export async function getAgentCapabilityGraph(
  input: { readonly orgId: string; readonly agentId: string },
  deps: { readonly repository: GetAgentCapabilityGraphRepository },
): Promise<GetAgentCapabilityGraphResult> {
  const row = await deps.repository.findForCapabilityGraph(input.orgId, input.agentId);
  if (row === null) {
    throw new GetAgentCapabilityGraphError("AGENT_NOT_FOUND");
  }
  return {
    agentId: row.agentId,
    name: row.name,
    roleLabel: row.roleLabel,
    skillMounts: row.skillMounts,
    toolWhitelist: row.toolWhitelist,
  };
}
