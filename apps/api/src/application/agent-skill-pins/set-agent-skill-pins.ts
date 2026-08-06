/**
 * #595 A2 —— **给一个已发布的 agent 换一套 pin 住的 skill 版本**。
 *
 * ## 为什么存在（验收第 4 条卡在这一步）
 *
 * URL 导入（#595 段 2）把 skill 落进模型 A 并发布；但发布出来的 skill 版本
 * **没有任何一条现存路径**能挂到某次 chat 调用上：
 *   · `run.skillVersionIds` 唯一来源是 `agents`/`agent_versions`
 *     （`pg-chat-message-command-repository.ts` 的 `resolvePublished`）；
 *   · `agent_versions.skill_version_ids` 唯一写入点是 agent starter-pack 导入
 *     （文件源，不是浏览器里选出来的）。
 * ⇒ 本用例是那条缺失的"浏览器能触发的"写入点。
 *
 * ## ⚠ 契约面是草案，尚未经人类签核
 *
 * 字段名 / 错误码全部来自 `packages/contracts` 的 `setAgentSkillPins`，
 * 那里标注**未签核**（ADR-023）。⛔ 本文件只 `import` 那份类型，不重新声明字段名。
 *
 * ## 顺序：授权 → 存在性/发布态 → 并发 → skill 版本校验 → 持久化
 *
 * ⚠ 授权必须排在**最前**——与 #595 URL 导入同一条理由（`import-skill-from-url.ts`
 *   文件头）：把它挪到后面，等于允许一个非 admin 用探测响应差异去打听
 *   agent/skill 是否存在，即使最终不落库。
 */
import type { IdentityRepository } from "../identity/ports";
import { toOrgId } from "../../domain/org-id";
import {
  SetAgentSkillPinsError,
  type SetAgentSkillPinsInput,
  type SetAgentSkillPinsResult,
} from "./set-agent-skill-pins-draft";

export interface AgentSkillPinsRepository {
  /**
   * 一次原子操作：校验 + 发布新版本。**不是**分成"先查再写"两步——
   * 并发判定（`expectedVersion`）与 skill 版本存在性校验都必须在
   * 同一笔事务里对着**同一个快照**判，否则两次查询之间可能被另一次并发写穿。
   */
  publishPins(input: {
    readonly orgId: string;
    readonly actorId: string;
    readonly agentId: string;
    readonly skillVersionIds: readonly string[];
    readonly expectedVersion: string;
  }): Promise<
    | { readonly kind: "ok"; readonly result: SetAgentSkillPinsResult }
    | { readonly kind: "agent-not-found" }
    | { readonly kind: "agent-not-published" }
    | { readonly kind: "version-changed" }
    | { readonly kind: "skill-version-not-found" }
  >;
}

export const AGENT_SKILL_PINS_REPOSITORY = Symbol("AgentSkillPinsRepository");

export interface SetAgentSkillPinsDeps {
  readonly identities: IdentityRepository;
  readonly repository: AgentSkillPinsRepository;
}

export async function setAgentSkillPins(
  input: SetAgentSkillPinsInput,
  deps: SetAgentSkillPinsDeps,
): Promise<SetAgentSkillPinsResult> {
  /**
   * ⚠⚠ 授权门，必须是这条用例做的第一件事。与 `import-skill-from-url.ts`
   * 逐字同一条门槛（`orgRole === "admin"`）——理由同样是"两条路径通向同一批表"：
   * pin 操作最终也是往 `agents`/`agent_versions` 写一行。
   */
  const membership = await deps.identities.findOrgMembership(input.actorId, toOrgId(input.orgId));
  if (!membership || membership.orgRole !== "admin") {
    throw new SetAgentSkillPinsError("ROLE_INSUFFICIENT");
  }

  const outcome = await deps.repository.publishPins({
    orgId: input.orgId,
    actorId: input.actorId,
    agentId: input.agentId,
    skillVersionIds: input.skillVersionIds,
    expectedVersion: input.expectedVersion,
  });

  switch (outcome.kind) {
    case "ok":
      return outcome.result;
    case "agent-not-found":
      throw new SetAgentSkillPinsError("AGENT_NOT_FOUND");
    case "agent-not-published":
      throw new SetAgentSkillPinsError("AGENT_NOT_PUBLISHED");
    case "version-changed":
      throw new SetAgentSkillPinsError("VERSION_CHANGED");
    case "skill-version-not-found":
      throw new SetAgentSkillPinsError("SKILL_VERSION_NOT_FOUND");
  }
}
