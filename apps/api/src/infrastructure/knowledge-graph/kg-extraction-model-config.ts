/**
 * Phase 18 F06 —— 抽取用哪个模型。
 *
 * 同 `chat/followup-suggestions-model-config.ts` 的理由：抽取是「读一条消息、回一段 JSON」的轻量元任务，
 * 走部署的标准单次补全 provider（`KERNEL_MODEL_PROVIDER`），不借用户在聊天里选的 Agent 的快照——
 * 那可能是 deep-agent，会把这次调用写进真实会话的历史。
 *
 * **显式开启**：`KG_EXTRACTION_ENABLED=1` 且配置了 provider 才跑。默认关的理由：抽取会对每条新消息
 * 额外调一次模型——在没打算用知识图谱的部署、以及大量起完整应用的集成 / e2e 测试里（它们会数模型调用），
 * 默认开等于悄悄改变了它们的行为与成本。关着的时候队列照样排，打开后从积压处补抽。
 */
export interface KgExtractionModelConfig {
  readonly enabled: boolean;
  readonly provider: string;
  readonly modelId: string;
}

export const KG_EXTRACTION_MODEL_CONFIG = Symbol("KgExtractionModelConfig");

export function readKgExtractionModelConfig(env: NodeJS.ProcessEnv = process.env): KgExtractionModelConfig {
  const provider = (env.KERNEL_MODEL_PROVIDER ?? "").trim();
  return {
    enabled: provider.length > 0 && (env.KG_EXTRACTION_ENABLED ?? "").trim() === "1",
    provider,
    modelId: (
      env.KERNEL_KG_EXTRACTION_MODEL_ID ?? env.KERNEL_DEFAULT_AGENT_MODEL_ID ?? env.KERNEL_MODEL_ID ?? "default"
    ).trim() || "default",
  };
}
