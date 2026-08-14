/**
 * `ensureDeepResearchAgent` -- 同一条产品裁决（#662/#661：新组织落地就该有能直接聊的
 * agent，不需要用户自己建）延伸到"深度研究"这个第二种能力上（人类原话，2026-08-07：
 * "去 LangChain GitHub 里面搜索 Open Deep Research 的一个 agent，导入到后台，在 chat
 * 里面可以去引用 deep research"）。
 *
 * ## 这不是同一个 agent 的第二个 skill，是一个独立 agent
 *
 * `open_deep_research`（langchain-ai，MIT）是一个独立的 LangGraph 图（多轮子代理研究 +
 * 反思 + 报告生成），不是一段能拼进现有 system prompt 的文本 skill——见
 * `deep-research-model-provider.ts` 头注。它作为一个**独立 agent**存在（`model_provider
 * = "open-deep-research"`），而不是"通用助手"的一个 skill 挂载，因为它的执行路径完全
 * 不同：不是"一次 chat completion"，是"提交一个 run 到另一个服务、轮询到终态"。
 *
 * ## 落库形状与 `ensure-default-agent.ts` 完全一致，只是内容不同
 *
 * 同一套"一落地即已发布"路径（`agents` + `agent_versions` + `capability_listings`，
 * `capability_listings.id = agentId`），复用 `pg-system-agent-repository.ts` 里已经
 * 抽出来的那份通用实现——两个 agent 的落库逻辑是同一份代码，不是两份互相漂移的拷贝，
 * 差异只在传进去的 `SystemAgentTemplate`。
 */
import { agentDefaults } from "@repo/contracts";

// stable_name / 显示名单源在 `@repo/contracts` 的 `agentDefaults`（2026-08-14，同
// `ensure-default-agent.ts` 那条注释）——再导出，调用方（同目录
// `pg-deep-research-agent-repository.ts`）导入路径不用改。
export const DEEP_RESEARCH_AGENT_STABLE_NAME = agentDefaults.DEEP_RESEARCH_AGENT_STABLE_NAME;
export const DEEP_RESEARCH_AGENT_NAME = agentDefaults.DEEP_RESEARCH_AGENT_NAME;
export const DEEP_RESEARCH_AGENT_PROVIDER = "open-deep-research";
/** `model_id` 一列本身没有外键校验（自由文本），这里只是给日志/审计一个可读标签。 */
export const DEEP_RESEARCH_AGENT_MODEL_ID = "deep-researcher";
export const DEEP_RESEARCH_AGENT_INSTRUCTIONS =
  "你是本组织的深度研究 agent（由 langchain-ai/open_deep_research 驱动，系统预置）。" +
  "收到问题后会展开多轮网络检索、拆解子问题、交叉核对来源，产出一份带引用的研究报告，" +
  "而不是一次性的简短回答——请预期它比普通助手回复慢（通常几分钟），但更全面、可核查。";

export interface EnsureDeepResearchAgentResult {
  readonly agentId: string;
  readonly created: boolean;
}

export interface EnsureDeepResearchAgentRepository {
  ensure(input: {
    readonly orgId: string;
    readonly actorId: string;
    readonly now: Date;
  }): Promise<EnsureDeepResearchAgentResult>;
}

export const ENSURE_DEEP_RESEARCH_AGENT_REPOSITORY = Symbol("EnsureDeepResearchAgentRepository");

export async function ensureDeepResearchAgent(
  deps: { readonly repo: EnsureDeepResearchAgentRepository },
  input: { readonly orgId: string; readonly actorId: string; readonly now?: () => Date },
): Promise<EnsureDeepResearchAgentResult> {
  return deps.repo.ensure({
    orgId: input.orgId,
    actorId: input.actorId,
    now: (input.now ?? (() => new Date()))(),
  });
}
