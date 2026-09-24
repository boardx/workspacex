/**
 * Phase 18 F06 —— 抽取用哪个模型。
 *
 * 同 `chat/followup-suggestions-model-config.ts` 的理由：抽取是「读一条消息、回一段 JSON」的轻量元任务，
 * 走部署的标准单次补全 provider（`KERNEL_MODEL_PROVIDER`），不借用户在聊天里选的 Agent 的快照——
 * 那可能是 deep-agent，会把这次调用写进真实会话的历史。
 *
 * `KG_EXTRACTION_ENABLED=0` 关掉抽取（队列照样排，打开后补抽）；没有配置 provider 时同样不跑。
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
    enabled: provider.length > 0 && (env.KG_EXTRACTION_ENABLED ?? "1").trim() !== "0",
    provider,
    modelId: (
      env.KERNEL_KG_EXTRACTION_MODEL_ID ?? env.KERNEL_DEFAULT_AGENT_MODEL_ID ?? env.KERNEL_MODEL_ID ?? "default"
    ).trim() || "default",
  };
}
