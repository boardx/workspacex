import { handoffRefusalNotice } from "@/lib/agent-handoff";
import { hasToolResult, type PreambleMessage } from "@/lib/chat-workbench/tool-preamble";
import { agentRole } from "@repo/contracts";

/**
 * UIUX r6 屏 5：转交请求登记成功后，服务端工具结果（以及据此写成的回答）是一句「已提交转交给…的请求，
 * 等待你在对话中确认」——它在**叙述它下面/旁边那张确认卡**。实时流里这句话不出现，刷新后持久化的
 * 回合把它画成了带第二个身份行的独立助手回合。判据：同一轮里、本条之前有一次 `request_handoff` 调用，
 * 它已有结果且不是拒绝（拒绝的解释由「没有转交」提示承载，模型后续真实回答照常显示），本条是没有
 * 工具调用的纯文本 assistant 消息 ⇒ 它只是在复述确认卡，不画。
 */
export function isHandoffCardNarration(message: PreambleMessage, messages: readonly PreambleMessage[]): boolean {
  if (message.role !== "assistant" || (message.toolCalls ?? []).length > 0) return false;
  const index = messages.findIndex((m) => m.id === message.id);
  if (index < 0) return false;
  for (let i = index - 1; i >= 0; i -= 1) {
    const prev = messages[i]!;
    if (prev.role === "user") return false;
    const call = (prev.toolCalls ?? []).find((c) => c.function.name === agentRole.REQUEST_HANDOFF_TOOL_NAME);
    if (!call) continue;
    const result = messages.find((m) => m.role === "tool" && m.toolCallId === call.id);
    if (!result || !hasToolResult(messages, call.id)) return false;
    return typeof result.content === "string" && handoffRefusalNotice(result.content) === null;
  }
  return false;
}
