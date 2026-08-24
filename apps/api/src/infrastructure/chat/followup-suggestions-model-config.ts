/**
 * `readFollowUpSuggestionsModelConfig` —— 追问建议专属的模型配置来源（issue：
 * deep-agent 线程追问建议仍是模板 的根因修复）。
 *
 * ## 为什么不能直接转发被选中 Agent 快照的 `modelProvider`/`modelId`
 *
 * `generate-followup-suggestions.ts` 曾经把 `resolvePublished` 拿到的 Agent 快照
 * `modelProvider`/`modelId` 原样转给 `ModelCallPort.complete`。这对走标准
 * `ConfiguredModelProvider`（dashscope）的 Agent 没问题，但对 `deep-agent` provider
 * （`DeepAgentModelProvider`）踩了两个坑，合起来就是「追问建议对 deep-agent 类线程
 * 永远是硬编码模板」这个可见 bug：
 *
 * 1. **会话线程被真实污染**：`DeepAgentModelProvider.ensureThread` 按 chat threadId
 *    确定性派生远端 LangGraph thread id 并 `if_exists:"do_nothing"` 幂等复用（DA-04）——
 *    传真实 `threadId` 等于往**同一条真实对话**的持久化历史（PostgresSaver checkpointer）
 *    里插入一轮「生成追问建议」的假 system/user turn，下一轮真实对话会把它当成上下文。
 * 2. **时延不匹配**：deep-agent 的 `complete()` 是「建 thread → 建 run → 轮询到终态」的
 *    完整 LangGraph 执行（即使不需要工具，默认路径也会先 `write_todos` 规划），而前端
 *    追问建议只给 8s（`chat-live-message-panel.tsx` 的 `Promise.race` 超时）等待预算——
 *    deep-agent 几乎永远赶不上，于是**每次都**静默落回前端确定性规则兜底
 *    （`computeFollowUpSuggestions`），用户看到的「能否再详细说明一下？」从未随对话变化过。
 *
 * ## 修法：追问建议是「读最近几轮对话提两三句追问」的轻量元任务，不需要被选中 Agent
 * 本身的推理/工具能力——固定改走这个部署配置的**标准单次补全 provider**（同
 * `configured-model-provider.ts` 的 `chatConfig.provider`，即 `KERNEL_MODEL_PROVIDER`），
 * 不管用户在聊天里选的是哪个 Agent、那个 Agent 的 `modelProvider` 是什么。
 *
 * 这**不是**「调不动真模型就退回模板」的降级：仍然是一次真实模型调用，只是换成一个
 * 更贴合这个任务形状（快、无状态、不需要工具）的 provider——同 `digital-interview-
 * model-config.ts` 的先例（元任务用固定 provider/modelId，不用某个 Agent 的快照）。
 *
 * `generate-followup-suggestions.ts` 里的 `resolvePublished` 调用**依然保留**——它验证
 * `agentId` 真的是这个 org 里一个已发布的 Agent（授权/存在性检查），只是不再把它的
 * `modelProvider`/`modelId` 转给 `complete()`。
 */
import type { FollowUpModelConfig } from "../../application/chat/generate-followup-suggestions";

export function readFollowUpSuggestionsModelConfig(
  env: NodeJS.ProcessEnv = process.env,
): FollowUpModelConfig {
  return {
    provider: (env.KERNEL_MODEL_PROVIDER ?? "").trim(),
    modelId: (
      env.KERNEL_FOLLOWUP_SUGGESTIONS_MODEL_ID
      ?? env.KERNEL_DEFAULT_AGENT_MODEL_ID
      ?? env.KERNEL_MODEL_ID
      ?? "default"
    ).trim() || "default",
  };
}
