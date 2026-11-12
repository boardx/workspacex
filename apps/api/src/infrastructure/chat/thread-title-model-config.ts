/**
 * `readThreadTitleModelConfig` —— 线程自动命名叠加模型摘要的专属模型配置来源。
 *
 * 同 `followup-suggestions-model-config.ts` 的既有先例：自动命名是"读首条消息起个
 * 名"的轻量元任务，不需要被选中 Agent 本身的推理/工具能力，固定改走这个部署配置的
 * **标准单次补全 provider**（同 `configured-model-provider.ts` 的 `chatConfig.provider`，
 * 即 `KERNEL_MODEL_PROVIDER`），不管用户在聊天里选的是哪个 Agent、那个 Agent 的
 * `modelProvider` 是什么——见 `generate-thread-title.ts` 头注「固定走 deps.titleModel」
 * 一节。
 *
 * Production uses the configured provider by default. The explicit flag takes
 * precedence so deployments can opt out and local/test callers can opt in.
 */
import type { ThreadTitleModelConfig } from "../../application/chat/generate-thread-title";

export function readThreadTitleModelConfig(
  env: NodeJS.ProcessEnv = process.env,
): ThreadTitleModelConfig {
  const setting = env.KERNEL_THREAD_TITLE_MODEL_ENABLED;
  const enabled = setting === undefined ? env.NODE_ENV === "production" : setting === "1";
  return {
    provider: enabled ? (env.KERNEL_MODEL_PROVIDER ?? "").trim() : "",
    modelId: (
      env.KERNEL_THREAD_TITLE_MODEL_ID
      ?? env.KERNEL_DEFAULT_AGENT_MODEL_ID
      ?? env.KERNEL_MODEL_ID
      ?? "default"
    ).trim() || "default",
  };
}
