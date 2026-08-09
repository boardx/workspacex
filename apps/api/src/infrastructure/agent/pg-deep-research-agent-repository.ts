import type { DatabasePort } from "../../application/ports/database.port";
import {
  DEEP_RESEARCH_AGENT_INSTRUCTIONS,
  DEEP_RESEARCH_AGENT_MODEL_ID,
  DEEP_RESEARCH_AGENT_NAME,
  DEEP_RESEARCH_AGENT_PROVIDER,
  DEEP_RESEARCH_AGENT_STABLE_NAME,
  type EnsureDeepResearchAgentRepository,
  type EnsureDeepResearchAgentResult,
} from "../../application/agent/ensure-deep-research-agent";
import { ensureSystemAgent, type SystemAgentTemplate } from "./pg-system-agent-repository";

/**
 * 同 `pg-default-agent-repository.ts` 复用的落库逻辑（`ensureSystemAgent`），模板不同：
 * `model_provider` 恒为 `"open-deep-research"`——不读 `KERNEL_MODEL_PROVIDER`（那个是
 * 给"一次 chat completion"型 agent 用的部署态唯一 provider），因为这个 agent 走的是
 * 完全不同的执行路径（`RoutingModelCallPort` 按 `model_provider` 分派到
 * `DeepResearchModelProvider`，见该文件头注）。lock key 用 661（与默认 agent 的 660
 * 分开，两个模板不会互相排队等同一把锁）。
 */
const DEEP_RESEARCH_AGENT_TEMPLATE: SystemAgentTemplate = {
  stableName: DEEP_RESEARCH_AGENT_STABLE_NAME,
  name: DEEP_RESEARCH_AGENT_NAME,
  abbr: "DR",
  duty: "多轮深度检索与调研综述",
  instructions: DEEP_RESEARCH_AGENT_INSTRUCTIONS,
  lockKey: 661,
  resolveModel: () => ({ provider: DEEP_RESEARCH_AGENT_PROVIDER, modelId: DEEP_RESEARCH_AGENT_MODEL_ID }),
};

export class PgDeepResearchAgentRepository implements EnsureDeepResearchAgentRepository {
  constructor(private readonly db: DatabasePort) {}

  async ensure(input: { readonly orgId: string; readonly actorId: string; readonly now: Date }): Promise<EnsureDeepResearchAgentResult> {
    return ensureSystemAgent(this.db, DEEP_RESEARCH_AGENT_TEMPLATE, input);
  }
}
