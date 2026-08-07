/**
 * `ensureDefaultAgent` -- 新组织必须有一个真实可用、已发布的默认 Agent（"通用助手"），
 * 不依赖用户手动新建+发布 agent 这条尚未落地的流程（`createAgent` 恒产出"草稿"，见
 * `domain/agent/clone.ts`，全仓零"发布"路径，登记 #660）。
 *
 * ## 为什么不复用 `createAgent`
 *
 * `createAgent` 的落库结果永远是草稿（无 `agent_versions` 行、`publishState` 恒
 * "草稿"）——这是 I-30 的既定语义，不能为了这个 feature 改。默认 agent 需要**立刻可
 * 执行**，与 `agent-starter-import`（#417/wave2）落地的形状完全一样：一个 `agents` 行
 * + 一行 `agent_versions`（`published_at` 非空）+ `agents.published_version_id` 指过去。
 * 本用例就是照这个已验证形状走的第二条写路径，不新造语义。
 *
 * ## 幂等
 *
 * 用 `agents.stable_name = DEFAULT_AGENT_STABLE_NAME` 去重（`agents_stable_name_uniq`
 * 已经是 `(org_id, stable_name)` 唯一键）——重复调用（例如同一个组织通过两条注册路径都
 * 触发一次）不会造出第二个默认 agent。
 *
 * ## capability_listings 这一行为什么 `id = agentId`
 *
 * `capability_listings` 的常规写路径（`mutateCapability`/`CapabilityRepository.insert`）
 * 明确"id 永远不接受调用方指定"（见 `capability-ports.ts` 的 `CapabilityInsert` 文档），
 * 理由是**管理台里人挑的 id 在跨组织语境下可能撞车**。这里不适用那条理由：agentId 由
 * 服务端 `newAgentId()` 生成、全局唯一，不是任何人挑的。而且这**不是新发明**——
 * `pg-agent-starter-import-repository.ts` 早就这么做（同一个事务里
 * `INSERT INTO capability_listings (id,...) VALUES (agentId,...)`），本用例的落库函数
 * 复刻的正是这一条已验证的写路径，只是触发时机从"管理员显式导入"换成"组织 bootstrap"。
 * 这条 id 关联不是可有可无的细节：chat 选择器（`personal-chat-screen.tsx` 的
 * `toAgentOption`）把 `listCapabilities` 返回的 `row.id` 原样当 `agentId` 发消息，
 * 后端 `resolvePublished` 按 `agents.id` 查——两个 id 不相等，选出来的默认 agent
 * 发消息就是 422，这个 feature 就没有兑现。
 */
export const DEFAULT_AGENT_STABLE_NAME = "default-assistant";
export const DEFAULT_AGENT_NAME = "通用助手";
export const DEFAULT_AGENT_INSTRUCTIONS =
  "你是本组织的默认通用助手（系统预置，开箱即用）。请友好、简洁、诚实地帮助用户完成日常任务；" +
  "遇到你不确定或无法完成的事，直接说明，不要编造。";

export interface EnsureDefaultAgentResult {
  readonly agentId: string;
  readonly created: boolean;
}

export interface EnsureDefaultAgentRepository {
  /** 落库 or 命中已存在的默认 agent；整个过程（含 capability_listings 行）必须同一事务原子完成。 */
  ensure(input: {
    readonly orgId: string;
    readonly actorId: string;
    readonly now: Date;
  }): Promise<EnsureDefaultAgentResult>;
}

export const ENSURE_DEFAULT_AGENT_REPOSITORY = Symbol("EnsureDefaultAgentRepository");

export async function ensureDefaultAgent(
  deps: { readonly repo: EnsureDefaultAgentRepository },
  input: { readonly orgId: string; readonly actorId: string; readonly now?: () => Date },
): Promise<EnsureDefaultAgentResult> {
  return deps.repo.ensure({
    orgId: input.orgId,
    actorId: input.actorId,
    now: (input.now ?? (() => new Date()))(),
  });
}
