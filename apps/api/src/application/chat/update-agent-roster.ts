/**
 * `updateAgentRoster` —— 改本线程的 agent 编制（F110 · uc-8-2 UC-7）。
 *
 * ⚠ **`[编制]` 在原型里是空按钮**（uc-8-2 R3 步骤 2 `[原型待补]`），契约注释逐字
 *   「本端口的形状是 `[设计]`」——见 `packages/contracts/src/chat.ts` 的
 *   `KNOWN_CONTRACT_GAPS.C_CHAT_4`。这里按契约已定的形状实现，不因为原型没画就跳过。
 *
 * ⚠ **部分成功即整体拒绝**：校验（越权 / 版本 / 越范围 / 不存在）与写入在
 *   `ChatRepository.updateAgentRoster` 的**同一个事务**里完成；本文件只把
 *   仓储报回来的判别结果映射成对外的错误类型，不做任何"先加后查"的两阶段调用
 *   （两阶段之间的窗口正是 V7 类并发问题的成因，同 `mutateThread` 的乐观锁写法）。
 *
 * ⚠ **写路径与读路径同一个可见性判定**（I-12 的同源要求）：先 `resolveVisibility`，
 *   不可见与不存在同一个出口，观察者恒无写权——与 `mutateThread` 完全同一套判断，
 *   这里不新写一份「谁能编辑编制」的角色判断。
 *
 * ## 审计事件类型 —— 🔴 已知契约缺口，未擅自修补
 *
 * `provenance.ProvenanceEventType` 是封闭枚举（ADR-020，只能人改），里面**没有**任何一档
 * 对应「线程编制被改」。最接近的是 `team-changed`（"团队归属变更"）——但那个词描述的是
 * **人**的团队归属，不是**一条对话线程**的 agent 编制，语义并不贴。这与 F109 当初报告的
 * `C_CHAT_5` / ADR-101 缺口同一个根：**F109 把三种线程动作先全写成 `human-edited`，
 * 人类追认后 ADR-101 才补了 `thread-created/renamed/deleted` 三个专用类型**。
 * 本文件按同一纪律处理：**不新造字符串塞进契约**（agent 不许改
 * `packages/contracts/src/**`），暂用最近似的 `team-changed` 顶着，并在这里把不贴切
 * 的地方写清楚，供下一次 ADR 追认时补一个专用的
 * `thread-agent-roster-changed`（同 F109 的 `thread-*` 命名构词法）。
 */
import type { OrgId } from "../../domain/org-id";
import type { ProvenanceWriter } from "../provenance/ports";
import type { ChatRepository } from "./ports";
import { resolveVisibility, type ResolveVisibilityDeps } from "./resolve-visibility";
import { ThreadNotVisibleError } from "./get-thread";
import { NoWriteRoleError, ThreadArchivedReadonlyError, VersionChangedError } from "./mutate-thread";

/** `AGENT_OUT_OF_SCOPE`。加入的 agent 不在本组织的 agent 目录（`org_agents`）里。 */
export class AgentOutOfScopeError extends Error {
  constructor(public readonly agentId: string) {
    super(`agent_out_of_scope:${agentId}`);
  }
}

/** `AGENT_NOT_FOUND`。要移除的 agent 本就不在这条线程的编制里。 */
export class AgentNotFoundError extends Error {
  constructor(public readonly agentId: string) {
    super(`agent_not_found:${agentId}`);
  }
}

export interface UpdateAgentRosterDeps extends ResolveVisibilityDeps {
  readonly chat: ChatRepository;
  readonly provenance: ProvenanceWriter;
}

export interface UpdateAgentRosterInput {
  readonly userId: string;
  readonly orgId: OrgId;
  readonly projectId: string;
  readonly threadId: string;
  readonly add: readonly string[];
  readonly remove: readonly string[];
  readonly expectedRosterVersion: number;
}

export interface UpdateAgentRosterResult {
  readonly rosterVersion: number;
  readonly agents: ReadonlyArray<{
    readonly id: string;
    readonly abbr: string;
    readonly name: string;
    readonly duty: string;
    /** #1705（#728 D-1）—— 同 `AgentPanelAgent.roleLabel`。 */
    readonly roleLabel: string;
    readonly presence: "present" | "away" | "off";
  }>;
  readonly auditEventId: string;
}

export async function updateAgentRoster(
  deps: UpdateAgentRosterDeps,
  input: UpdateAgentRosterInput,
): Promise<UpdateAgentRosterResult> {
  const outcome = await resolveVisibility(deps, input);
  if (outcome.kind !== "allow") throw new ThreadNotVisibleError();

  // 归档线程只读——全部写操作被拒（I-15），编制变更不例外。
  if (outcome.thread.archived) {
    await auditRefusal(deps, input, "THREAD_ARCHIVED_READONLY");
    throw new ThreadArchivedReadonlyError();
  }

  const role = outcome.actor.projectRole;
  if (role === null || role === "observer") {
    await auditRefusal(deps, input, "NO_WRITE_ROLE");
    throw new NoWriteRoleError();
  }

  const result = await deps.chat.updateAgentRoster(
    input.orgId,
    input.threadId,
    input.add,
    input.remove,
    input.expectedRosterVersion,
  );

  if (result.kind === "version-changed") throw new VersionChangedError();
  if (result.kind === "agent-out-of-scope") {
    await auditRefusal(deps, input, "AGENT_OUT_OF_SCOPE");
    throw new AgentOutOfScopeError(result.agentId);
  }
  if (result.kind === "agent-not-found") {
    await auditRefusal(deps, input, "AGENT_NOT_FOUND");
    throw new AgentNotFoundError(result.agentId);
  }

  const auditEventId = await deps.provenance.append({
    orgId: input.orgId,
    // 🔴 见文件头「审计事件类型」一节：`team-changed` 是已知不贴切的顶替，不是结论。
    type: "team-changed",
    actorId: input.userId,
    target: { kind: "thread", id: input.threadId },
    detail: {
      projectId: input.projectId,
      add: input.add,
      remove: input.remove,
      rosterVersion: result.rosterVersion,
    },
  });

  return { rosterVersion: result.rosterVersion, agents: result.agents, auditEventId };
}

async function auditRefusal(
  deps: UpdateAgentRosterDeps,
  input: UpdateAgentRosterInput,
  reason: string,
): Promise<void> {
  await deps.provenance.append({
    orgId: input.orgId,
    type: "unauthorized-attempt",
    actorId: input.userId,
    target: { kind: "thread", id: input.threadId },
    detail: { chatOp: "update-agent-roster", projectId: input.projectId, reason },
  });
}
