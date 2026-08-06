/**
 * `trialRunAgent` -- 契约束 `agent-runtime`（F48-60）UC-4.1 R3 步骤 8：`[试跑]`
 * （packages/contracts/src/agent-runtime.ts:1621，#595 拆分 Line A）。
 *
 * ## 试跑 ≠ 私聊，这条边界由这份用例的形状守住
 *
 * 契约注释逐字：「试跑不写入正式记录……试跑 ≠ 私聊：两者的上下文、留痕与转出能力都不同，
 * 不得复用同一实现而混淆审计归属」。所以这里**不**调用 `AgentRunStore.claimQueued` /
 * `storeOutputAwaitingWriteback` / `commitWriteback` 那一整条 `agent_runs` 状态机——那条链
 * 的前提是「这次调用要写回某条 Chat 消息」，试跑没有消息、没有 thread，套用它会在
 * `agent_runs` 里插一行找不到归属的记录。
 *
 * 真正复用的，是**同一条链路里与「写回」无关的两段**：
 *   · `buildSystemPrompt`（execute-run.ts）—— prompt 的拼法只有一处
 *   · `AgentRunStore.readPinnedSkills` —— 按 `SKILL.md` 取内容的查询只有一处
 *   · `ModelCallPort` / `ConfiguredModelProvider` —— 全仓唯一一个真的会发 HTTP 请求
 *     调模型的实现（`loopback-model-provider.ts` 头注逐字确认了这一点）
 *
 * ## 这份实现覆盖的面，和已知没覆盖的面
 *
 * agent-runtime.ts 是一个基本未落地的大契约束（模型池路由、MCP 工具鉴权、`AgentRow` 列表
 * 等等一概没有代码）。`trialRunAgent` 恰好是其中可以在**不**建那整套基础设施的前提下诚实
 * 落地的一角，原因是它读写的 Agent 实体其实是 wave2 delta（#417/#414）已经建好的
 * `agents`/`agent_versions`，而不是 agent-runtime.ts 自己描述的、还没有任何存储的那个
 * 版本——`agent_versions.tool_policy` 的 DB CHECK 强制 `jsonb_array_length = 0`
 * 就是这条对应关系的证据：**这一阶段的 Agent 结构上不可能挂任何工具**，所以
 * `trialRunAgent.out.toolCalls` 恒为 `[]`、`dataRead` 恒为 `[]`，不是偷懒不填，
 * 是这两个字段在当前阶段没有东西可以产生。
 *
 * 明确未覆盖、且不在本次改动范围内的两点（都需要单独的设计/签核，不能在这里顺手造）：
 *   · `REQUEST_TIMEOUT`：契约允许，但 `ModelCallPort` 唯一的实现
 *     （`ConfiguredModelProvider`）把「abort 超时」与「其它 transport 失败」揉进同一个
 *     `MODEL_CALL_FAILED`，本用例因此把两者都折进 `AGENT_DEPENDENCY_FAILED`——
 *     `REQUEST_TIMEOUT` 这个码目前没有任何路径能抛出。
 *   · R9「超过 10 秒转后台任务」：`asyncTaskId` 恒为 `null`。做真的异步转移需要一个任务
 *     队列/轮询端点，这是本仓目前没有的基础设施，不是"顺手加一个字段"能带出来的东西。
 *
 * ## 角色门槛是判断，不是抄契约条文
 *
 * agent-runtime.ts 的 R5「逐角色」矩阵从未落地过任何一条（`listAgents` 等姐妹操作也都还
 * 没有实现）。本用例复用同一张 `agents`/`agent_versions` 表上**已经存在的唯一先例**——
 * `importAgentStarterPack`（`import-agent-starter-pack.ts`）对这套表的写路径要求组织
 * 管理员——试跑同一张表上的内容沿用同一条门槛，而不是发明一条新的、无先例的角色判断。
 */
import type { OrgId } from "../../domain/org-id";
import type { IdentityRepository } from "../identity/ports";
import type { PublishedAgentReader } from "../chat/message-command-ports";
import { buildSystemPrompt } from "./execute-run";
import type { AgentRunStore, ModelCallPort } from "./ports";
import { ModelCallError } from "./ports";

export class TrialRunAgentRoleInsufficientError extends Error {
  constructor() {
    super("ROLE_INSUFFICIENT");
    this.name = "TrialRunAgentRoleInsufficientError";
  }
}

/** Carries a server-log-only detail; never surfaced past the controller boundary. */
export class TrialRunAgentDependencyFailedError extends Error {
  constructor(readonly detail: string) {
    super("AGENT_DEPENDENCY_FAILED");
    this.name = "TrialRunAgentDependencyFailedError";
  }
}

export interface TrialRunAgentInput {
  readonly orgId: OrgId;
  readonly actorId: string;
  readonly agentId: string;
  readonly scenario: string;
}

export interface TrialRunAgentStep {
  readonly ordinal: number;
  readonly text: string;
}

export interface TrialRunAgentResult {
  readonly steps: readonly TrialRunAgentStep[];
  /** Structurally always `[]` -- see file header (`tool_policy` CHECK). */
  readonly toolCalls: readonly never[];
  /** Structurally always `[]` -- no data-scope concept exists on `agent_versions` yet. */
  readonly dataRead: readonly never[];
  readonly durationMs: number;
  readonly tokens: number;
  /** Always `null` today -- R9's async conversion is not built. See file header. */
  readonly asyncTaskId: null;
}

export interface TrialRunAgentDeps {
  readonly identities: IdentityRepository;
  readonly agents: PublishedAgentReader;
  readonly runs: Pick<AgentRunStore, "readPinnedSkills">;
  readonly model: ModelCallPort;
  readonly log: (message: string, detail: Record<string, unknown>) => void;
  /** Injected for determinism under test; defaults to the real clock. */
  readonly now?: () => number;
}

export async function trialRunAgent(
  deps: TrialRunAgentDeps,
  input: TrialRunAgentInput,
): Promise<TrialRunAgentResult> {
  const membership = await deps.identities.findOrgMembership(input.actorId, input.orgId);
  if (!membership || membership.orgRole !== "admin") {
    throw new TrialRunAgentRoleInsufficientError();
  }

  const snapshot = await deps.agents.resolvePublished(input.orgId, input.agentId);
  if (snapshot === null) {
    throw new TrialRunAgentDependencyFailedError("agent has no published version");
  }

  const skills = await deps.runs.readPinnedSkills(input.orgId, snapshot.skillVersionIds);
  if (skills.length !== snapshot.skillVersionIds.length) {
    throw new TrialRunAgentDependencyFailedError(
      `pinned ${snapshot.skillVersionIds.length}, retrieved ${skills.length}`,
    );
  }
  const system = buildSystemPrompt(snapshot.instructions, skills);

  const now = deps.now ?? Date.now;
  const startedAt = now();
  let completion: { readonly text: string; readonly tokens?: number };
  try {
    completion = await deps.model.complete({
      modelProvider: snapshot.modelProvider,
      modelId: snapshot.modelId,
      system,
      user: input.scenario,
    });
  } catch (e) {
    const detail = e instanceof ModelCallError ? e.detail : "unexpected model call failure";
    deps.log("agent trial run model call failed", {
      agentId: input.agentId,
      modelProvider: snapshot.modelProvider,
      modelId: snapshot.modelId,
      code: e instanceof ModelCallError ? e.code : "MODEL_CALL_FAILED",
      detail,
    });
    throw new TrialRunAgentDependencyFailedError(detail);
  }
  const durationMs = Math.max(0, Math.round(now() - startedAt));

  return {
    steps: [{ ordinal: 1, text: completion.text }],
    toolCalls: [],
    dataRead: [],
    durationMs,
    tokens: Math.max(0, Math.floor(completion.tokens ?? 0)),
    asyncTaskId: null,
  };
}
