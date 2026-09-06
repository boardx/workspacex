/**
 * 2026-09-06 人类直接反馈（devapp 实测）—— agent 在回复里问「回复 A 或 B」，随后
 * 继续调工具（run 仍在 `running`），用户在主 composer 里敲了「B」却发不出去：发送键是
 * 「停止」、Enter 无响应、页脚一句「Agent 正在处理上一条消息，请稍候…」。用户的原话：
 * 「要改为可以回复 A/B，就算 agent 还在生成」。
 *
 * 主 composer 在 run 进行中**不再禁止发送**，一条正文按下面两条路之一走，规则集中在
 * 这里（纯函数，可单测），`copilotkit-v2-panel-body.tsx` 只负责调用：
 *
 * - **`interject`**：在途 run 的真实 `agent_runs.id` 已解析、且内核状态是 `running`
 *   （`useChatHostInterjectionRun`，issue #2756）⇒ 走 `POST /agent-runs/:runId/interject`。
 *   后端在下一步（工具门 / 模型下一轮）之前取走它（`interjection-handling.ts`），
 *   正是「我问了 A/B，你答 B，我接着按 B 做」这条链路要的语义，不打断正在执行的这一步。
 * - **`queue`**：拿不到 runId 或状态不是 `running`（时序缝隙、`awaiting_tool_permission`、
 *   `paused`、恢复路径还没核实完……）⇒ 不发一条注定被 409 拒掉的插话，改为**排队**：
 *   正文离开输入框、页脚如实说明「本轮结束后自动发送」，run 一结束（自然结束或用户按
 *   「停止」）宿主再把它当一条正常消息发出。用户随时可以取消排队把文字拿回输入框。
 *
 * 两条路都不 `abortRun()`：用户是在**回答** agent，不是在打断它；打断仍是「停止」键
 * 自己的事（输入框为空时它还在原位）。
 */
import type { AgentKernelRunStatus } from "./agent-kernel-stream";

export type RunningReplyRoute = "interject" | "queue";

export interface RunningReplyRun {
  readonly runId: string | null;
  readonly status: AgentKernelRunStatus | null;
}

/** 与 `chat-host-interjection.tsx` 渲染插话入口的判据逐字相同（同一条契约 UC-4 规则）。 */
export function resolveRunningReplyRoute(run: RunningReplyRun): RunningReplyRoute {
  return run.runId !== null && run.runId !== "" && run.status === "running" ? "interject" : "queue";
}

const PREVIEW_MAX = 24;

export function previewReplyText(text: string): string {
  return text.length > PREVIEW_MAX ? `${text.slice(0, PREVIEW_MAX)}…` : text;
}

/** 插话已被服务端接收后页脚的一句话（对应 `InterjectionComposer` 的 `interjection-ack`）。 */
export function runningReplyAckCopy(text: string): string {
  return `已收到「${previewReplyText(text)}」，已排队等待本轮安全边界处理`;
}

/** 排队等待本轮结束时页脚的一句话。 */
export function queuedReplyCopy(text: string): string {
  return `本地排队：「${previewReplyText(text)}」将在本轮结束后发送`;
}
