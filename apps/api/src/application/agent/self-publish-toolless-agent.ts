/**
 * `selfPublishToollessAgent`（#660）。**⚠⚠ 草案，尚未经人类签核**（AR11）。
 *
 * ## 顺序：授权 → 读真实前态 → 判定 → 落库
 *
 * 与 `create-agent.ts` / `skill-review.controller.ts` 逐字同一条纪律：
 *
 * 1. **授权最先**。否则非 admin 能靠「`AGENT_NOT_FOUND` 与 `AGENT_NOT_TOOLLESS`
 *    两种响应不一样」探测组织内到底有哪些 agent、它们配没配工具。
 * 2. **前态来自库，不来自请求体**。调用方说"我这个 agent 没有工具"是不作数的——
 *    `toolWhitelist` / `skillMounts` / `publishState` 三项全部从 `agents` 行读。
 * 3. **判定交给 domain**，本文件不复述任何一条判据（`checkToollessSelfPublish`）。
 * 4. **只有放行才落库**，且落库是一个事务：铸版本 + 指 `published_version_id`
 *    + 写 `capability_listings`。缺任何一步，用户在 chat 里要么选不到它，
 *    要么选到了发消息还是 422 —— 这个 feature 就没有兑现。
 *
 * ## ⚠ 这里没有「顺手把它改成运行中」的捷径
 *
 * `publishState` 落 `运行中` 与铸出 `agent_versions` 行**必须同时发生**。只改
 * `publish_state` 而不铸版本，`PgPublishedAgentReader` 的 JOIN 依然查不到，
 * 发消息依然 422 —— 界面上却显示"已发布"。这正是见证测试 C 反证盯的那一刀。
 */
import { checkToollessSelfPublish } from "../../domain/agent/self-publish";
import type { AgentDefinition } from "../../domain/agent/definition";
import type { IdentityRepository } from "../identity/ports";
import { toOrgId } from "../../domain/org-id";

export type SelfPublishErrorCode =
  | "ROLE_INSUFFICIENT"
  | "AGENT_NOT_FOUND"
  | "AGENT_NOT_DRAFT"
  | "AGENT_NOT_TOOLLESS"
  | "AGENT_VISIBILITY_UNSUPPORTED"
  | "AGENT_NO_EXECUTABLE_DEFINITION";

export class SelfPublishAgentError extends Error {
  constructor(readonly code: SelfPublishErrorCode) {
    super(code);
    this.name = "SelfPublishAgentError";
  }
}

export interface SelfPublishAgentInput {
  readonly orgId: string;
  readonly actorId: string;
  readonly agentId: string;
}

export interface SelfPublishAgentResult {
  readonly agentId: string;
  readonly agentVersionId: string;
  readonly publishState: "运行中";
}

export interface SelfPublishAgentRepository {
  /** 读真实前态。跨组织一律 null（同 `findForClone` 的 orgId 过滤）。 */
  findForSelfPublish(orgId: string, agentId: string): Promise<AgentDefinition | null>;
  /**
   * 一个事务里：INSERT `agent_versions` + UPDATE `agents`
   * (`publish_state='运行中'`, `published_version_id`) + UPSERT `capability_listings`。
   * ⚠ 返回新版本 id；实现不得在任何一步失败后留下"半发布"的行。
   */
  publish(input: {
    readonly orgId: string;
    readonly agentId: string;
    readonly actorId: string;
    readonly now: Date;
  }): Promise<{ readonly agentVersionId: string }>;
}

export const SELF_PUBLISH_AGENT_REPOSITORY = Symbol("SelfPublishAgentRepository");

export interface SelfPublishAgentDeps {
  readonly identities: IdentityRepository;
  readonly repository: SelfPublishAgentRepository;
  readonly now?: () => Date;
}

export async function selfPublishToollessAgent(
  input: SelfPublishAgentInput,
  deps: SelfPublishAgentDeps,
): Promise<SelfPublishAgentResult> {
  /* ① 授权门，必须最先。 */
  const membership = await deps.identities.findOrgMembership(input.actorId, toOrgId(input.orgId));
  if (!membership || membership.orgRole !== "admin") {
    throw new SelfPublishAgentError("ROLE_INSUFFICIENT");
  }

  /* ② 前态来自库。 */
  const agent = await deps.repository.findForSelfPublish(input.orgId, input.agentId);
  if (agent === null) throw new SelfPublishAgentError("AGENT_NOT_FOUND");

  /* ③ 判定住在 domain，本文件不复述。 */
  const gate = checkToollessSelfPublish(agent);
  if (!gate.ok) throw new SelfPublishAgentError(gate.reason);

  /* ④ 放行才落库。 */
  const { agentVersionId } = await deps.repository.publish({
    orgId: input.orgId,
    agentId: input.agentId,
    actorId: input.actorId,
    now: (deps.now ?? (() => new Date()))(),
  });

  return { agentId: input.agentId, agentVersionId, publishState: gate.publishState };
}
