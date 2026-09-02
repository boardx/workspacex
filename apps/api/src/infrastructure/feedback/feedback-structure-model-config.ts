/**
 * `readFeedbackStructureModelConfig` —— "语音转结构化反馈"这个元任务的专属模型配置来源。
 *
 * 同 `thread-title-model-config.ts` 的既有先例（固定改走部署的标准单次补全 provider，
 * 不管用户当时在跟哪个 Agent 对话），但**没有那个文件的"默认关闭"开关**——那条纪律是
 * 因为线程命名挂在**每一条**线程首条消息上，不显式默认关会污染既有测试的调用计数
 * （见该文件头注）。这里的调用只在用户**主动点击**"AI 整理"按钮时才发生，没有那个
 * 污染既有测试的风险，因此不需要一个只有运维显式开了才生效的开关——只要这个部署配了
 * 标准模型 provider，这个按钮就能用。
 */
import type { FeedbackStructureModelConfig } from "../../application/feedback/structure-feedback-draft";

export function readFeedbackStructureModelConfig(
  env: NodeJS.ProcessEnv = process.env,
): FeedbackStructureModelConfig {
  return {
    provider: (env.KERNEL_MODEL_PROVIDER ?? "").trim(),
    modelId: (
      env.KERNEL_FEEDBACK_STRUCTURE_MODEL_ID
      ?? env.KERNEL_DEFAULT_AGENT_MODEL_ID
      ?? env.KERNEL_MODEL_ID
      ?? "default"
    ).trim() || "default",
  };
}
