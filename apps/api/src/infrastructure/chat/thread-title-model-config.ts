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
 * ⚠ **`KERNEL_THREAD_TITLE_MODEL_ENABLED === "1"` 才真的调模型**，同
 * `KERNEL_MODEL_STREAM_ENABLED` / `KERNEL_DEEP_AGENT_STREAM_ENABLED` 的既有先例——
 * 新模型调用行为默认关，按部署显式开。这条不只是灰度纪律：这条通路挂在
 * `acceptHumanMessage` 上，是**每一条线程首条消息**都会走的，关闭时 `provider` 读成
 * `""`（`generateThreadTitle` 就地短路，不发起调用），任何发首条消息、又在同一个
 * mock provider 上断言调用次数/内容的既有测试才不会被这次额外调用污染——上线前
 * `gates-test` 实测踩过这个坑。**该常量默认关闭意味着这个部署要打开人类已经裁决
 * 接受的这个功能，需要显式在部署配置里设 `KERNEL_THREAD_TITLE_MODEL_ENABLED=1`**
 * （本仓没有集中管 `KERNEL_*` 的部署配置文件，这一步在仓库外，留给运维显式做）。
 */
import type { ThreadTitleModelConfig } from "../../application/chat/generate-thread-title";

export function readThreadTitleModelConfig(
  env: NodeJS.ProcessEnv = process.env,
): ThreadTitleModelConfig {
  const enabled = env.KERNEL_THREAD_TITLE_MODEL_ENABLED === "1";
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
