/**
 * `readErrorLogSummaryModelConfig` —— "系统异常 AI 摘要"这个元任务的专属模型配置来源。
 *
 * 同 `feedback-structure-model-config.ts` 的既有先例（固定改走部署的标准单次补全
 * provider，不管当时有没有人在跟哪个 Agent 对话）。**没有默认关闭的开关**——理由与
 * 反馈整理那份配置相同：这不是挂在每条消息上的调用，是每条新异常落库后各触发一次，
 * 只要这个部署配了标准模型 provider，生成就能跑。
 */
import type { ErrorLogSummaryModelConfig } from "../../application/system/summarize-error-log";

export function readErrorLogSummaryModelConfig(
  env: NodeJS.ProcessEnv = process.env,
): ErrorLogSummaryModelConfig {
  return {
    provider: (env.KERNEL_MODEL_PROVIDER ?? "").trim(),
    modelId: (
      env.KERNEL_ERROR_LOG_SUMMARY_MODEL_ID
      ?? env.KERNEL_DEFAULT_AGENT_MODEL_ID
      ?? env.KERNEL_MODEL_ID
      ?? "default"
    ).trim() || "default",
  };
}
