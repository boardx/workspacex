/**
 * #595 A2 —— `setAgentSkillPins` 的草案类型。**只派生，不声明**。
 *
 * 与 #595 段 2 `url-import-draft.ts` 同一个理由（那里也踩过、也改过一次）：
 * `tests/contract-single-source.test.ts` 逐行禁止 `apps/api/src` 出现
 * `const X = z.object(`——形状只有一份，住在
 * `packages/contracts/src/agent-runtime.ts` 的 `setAgentSkillPins`
 * （标注未签核）。本文件只 `z.infer` 派生，⛔ 不重新声明字段名。
 */
import type { z } from "zod";
import { agentRuntime as C } from "@repo/contracts";

export type SetAgentSkillPinsInput = z.infer<typeof C.operations.setAgentSkillPins.in> & {
  readonly orgId: string;
  readonly actorId: string;
};

export type SetAgentSkillPinsResult = z.infer<typeof C.operations.setAgentSkillPins.out>;

export type SetAgentSkillPinsFailure = z.infer<typeof C.AgentSkillPinsError>;

export class SetAgentSkillPinsError extends Error {
  constructor(readonly code: SetAgentSkillPinsFailure) {
    super(`set agent skill pins failed: ${code}`);
    this.name = "SetAgentSkillPinsError";
  }
}
