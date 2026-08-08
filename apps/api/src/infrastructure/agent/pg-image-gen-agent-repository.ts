import type { DatabasePort } from "../../application/ports/database.port";
import {
  IMAGE_GEN_AGENT_INSTRUCTIONS,
  IMAGE_GEN_AGENT_MODEL_ID,
  IMAGE_GEN_AGENT_NAME,
  IMAGE_GEN_AGENT_PROVIDER,
  IMAGE_GEN_AGENT_STABLE_NAME,
  type EnsureImageGenAgentRepository,
  type EnsureImageGenAgentResult,
} from "../../application/agent/ensure-image-gen-agent";
import { ensureSystemAgent, type SystemAgentTemplate } from "./pg-system-agent-repository";

/**
 * 同 `pg-deep-research-agent-repository.ts` 复用的落库逻辑（`ensureSystemAgent`），
 * 第三个系统预置 agent。`model_provider` 恒为 `"bailian-image"`——不读
 * `KERNEL_MODEL_PROVIDER`（那是 chat completion 型 agent 的部署态唯一 provider），
 * 因为这个 agent 走的是完全不同的执行路径（`RoutingModelCallPort` 按 `model_provider`
 * 分派到 `BailianImageProvider`，见该文件头注）。lock key 用 662（与 660/661 分开，
 * 三个模板不会互相排队等同一把锁）。
 */
const IMAGE_GEN_AGENT_TEMPLATE: SystemAgentTemplate = {
  stableName: IMAGE_GEN_AGENT_STABLE_NAME,
  name: IMAGE_GEN_AGENT_NAME,
  instructions: IMAGE_GEN_AGENT_INSTRUCTIONS,
  lockKey: 662,
  resolveModel: () => ({ provider: IMAGE_GEN_AGENT_PROVIDER, modelId: IMAGE_GEN_AGENT_MODEL_ID }),
};

export class PgImageGenAgentRepository implements EnsureImageGenAgentRepository {
  constructor(private readonly db: DatabasePort) {}

  async ensure(input: { readonly orgId: string; readonly actorId: string; readonly now: Date }): Promise<EnsureImageGenAgentResult> {
    return ensureSystemAgent(this.db, IMAGE_GEN_AGENT_TEMPLATE, input);
  }
}
