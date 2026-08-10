/**
 * #660 候选 A —— 写入 agent 的**可执行定义**（`agents.instructions`）。
 *
 * ## ⚠ 范围：只做 `instructions` 这一个字段，不是完整的 `updateAgentDefinition`
 *
 * 契约的 `updateAgentDefinition.patch` 有七个字段（role / visibility /
 * proactiveSpeaking / requiresApproval / modelId / concurrencyLimit / degradePolicy
 * + 本次新增的 instructions），并带 `expectedVersion` 乐观并发与
 * `MODEL_NOT_SELECTABLE` / `MODEL_ID_MUST_BE_SINGLE` / `COMPOSITE_MEMBER_DISABLED`
 * 三条模型侧校验。**那六个字段与那三条校验本轮一个都没做。**
 *
 * 为什么只做一个字段而不是顺手做完：其余字段各自挂着自己的门
 * （`modelId` 要过 `listSelectableModels` 的可选池，而那条读路径的候选集口径
 * 本身还挂在 `KNOWN_CONTRACT_GAPS.AR6` 上未裁），把它们塞进本次改动等于在一个
 * 未裁的判据上先落实现。⇒ 本文件**只**承担签核裁决（候选 A）真正要求的那一件事：
 * 让用户能把「这个 agent 执行什么」写进去。
 *
 * ⚠ 因此 controller 只挂 `PATCH /agents/:agentId` 的 **instructions 子集**，
 *   收到其它 patch 字段一律拒 **HTTP 501 且不带 `reasonCode`**，**不静默忽略**
 *   —— 静默忽略会让调用方以为改成功了。
 *   501 而不是自造一个码：契约的 `err` 数组里没有能表达「这个字段还没接线」的成员，
 *   而**发明一个码等于替签核人做决定**（同 #856 对 `AGENT_STATE_CONFLICT` 的处理，
 *   以及 `KNOWN_CONTRACT_GAPS.AR7` 的理由）。`all-exceptions.filter.ts` 是允许列表，
 *   自造的码本来也会被丢掉。
 *
 * ## 授权与 `expectedVersion`
 *
 * 授权同 `create-agent.ts`：org admin，且是**第一个**动作。
 * `expectedVersion` 本轮**不校验**：契约里它对应 `agents.published_version_id`
 * （见 `setAgentSkillPins` 的用法），而一个还没发布的草稿 agent 那一列恒为 NULL，
 * 拿它做乐观并发对草稿态没有意义。⚠ 这条限制如实写在这里，不是忘了：
 * 等 agent 有了发布态之后再改指令时，`VERSION_CHANGED` 才有真实语义。
 */
import type { IdentityRepository } from "../identity/ports";
import { toOrgId } from "../../domain/org-id";

export type SetAgentInstructionsErrorCode =
  | "ROLE_INSUFFICIENT"
  | "AGENT_NOT_FOUND";

export class SetAgentInstructionsError extends Error {
  constructor(readonly code: SetAgentInstructionsErrorCode) {
    super(code);
    this.name = "SetAgentInstructionsError";
  }
}

export interface SetAgentInstructionsRepository {
  /**
   * 写入 `agents.instructions`。返回 false = 该 org 下没有这个 agent。
   * ⚠ 实现不得在 agent 不存在时静默成功（那会让调用方以为配好了）。
   */
  setInstructions(input: {
    readonly orgId: string;
    readonly agentId: string;
    readonly instructions: string;
  }): Promise<boolean>;
}

export const SET_AGENT_INSTRUCTIONS_REPOSITORY = Symbol("SetAgentInstructionsRepository");

export async function setAgentInstructions(
  input: {
    readonly orgId: string;
    readonly actorId: string;
    readonly agentId: string;
    readonly instructions: string;
  },
  deps: {
    readonly identities: IdentityRepository;
    readonly repository: SetAgentInstructionsRepository;
  },
): Promise<void> {
  /* ① 授权门，必须最先——同 create-agent.ts 逐字同一条门槛。 */
  const membership = await deps.identities.findOrgMembership(input.actorId, toOrgId(input.orgId));
  if (!membership || membership.orgRole !== "admin") {
    throw new SetAgentInstructionsError("ROLE_INSUFFICIENT");
  }

  const ok = await deps.repository.setInstructions({
    orgId: input.orgId,
    agentId: input.agentId,
    instructions: input.instructions,
  });
  if (!ok) throw new SetAgentInstructionsError("AGENT_NOT_FOUND");
}
