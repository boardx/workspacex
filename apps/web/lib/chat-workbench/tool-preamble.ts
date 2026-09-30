"use client";
import { createContext, useContext } from "react";

/**
 * UIUX r4 —— 「正在提交……」式的工具前导语（pending preamble）在**实时流**里的收尾。
 *
 * 流式时框架把一轮拆成几条消息：先是一条只有正文的 assistant 消息（前导语），再是
 * `TOOL_CALL_START` 新造的只带工具调用的气泡，然后是 `tool` 结果。刷新后服务端 `/state`
 * 已把前导语清掉，可实时流里那条正文消息还在——它没有工具调用，框架的
 * `MemoizedAssistantMessage` 也不会因为后面来了调用/结果而重渲染它（`props.messages`
 * 是旧数组）。所以这里两件事：
 *  1. `LiveMessagesContext`：`TaskTimeline` 下发**当前**消息列表；context 变化穿透 memo。
 *  2. `toolPreambleCall`：判定一条消息的正文是不是某个工具调用的前导语（同条带调用，或
 *     同一轮里紧随其后的第一条带调用的 assistant 消息命中该工具）。
 * 调用方各自决定「何时算已了结」（有 `tool` 结果 / 已裁决），这里只给判据。
 * 本文件在 ag07 与 dh-ui-gaps 两条分支上内容逐字相同（便于合并）。
 */
export interface PreambleToolCall { readonly id: string; readonly function: { readonly name: string } }
export interface PreambleMessage {
  readonly id: string;
  readonly role?: string;
  readonly content?: unknown;
  readonly toolCalls?: readonly PreambleToolCall[];
  readonly toolCallId?: string;
}

export const LiveMessagesContext = createContext<readonly PreambleMessage[] | null>(null);

/** 当前消息列表：优先取 `TaskTimeline` 下发的实时列表，缺席时退回框架给的 `props.messages`。 */
export function useLiveMessages(fallback: readonly PreambleMessage[] | undefined): readonly PreambleMessage[] {
  return useContext(LiveMessagesContext) ?? fallback ?? [];
}

function hasText(message: PreambleMessage): boolean {
  return typeof message.content === "string" && message.content.trim() !== "";
}

/** 这条消息的正文若是某个目标工具调用的前导语，返回那次调用；否则 null。 */
export function toolPreambleCall(
  message: PreambleMessage,
  messages: readonly PreambleMessage[],
  isTarget: (toolName: string) => boolean,
): PreambleToolCall | null {
  const own = message.toolCalls ?? [];
  if (own.length > 0) return own.find((call) => isTarget(call.function.name)) ?? null;
  const index = messages.findIndex((m) => m.id === message.id);
  if (index < 0) return null;
  for (let i = index + 1; i < messages.length; i += 1) {
    const next = messages[i]!;
    if (next.role === "user") return null;
    if (next.role !== "assistant") continue;
    const calls = next.toolCalls ?? [];
    if (calls.length > 0) return calls.find((call) => isTarget(call.function.name)) ?? null;
    if (hasText(next)) return null;
  }
  return null;
}

/** 该工具调用是否已有 `tool` 结果消息。 */
export function hasToolResult(messages: readonly PreambleMessage[], toolCallId: string): boolean {
  return messages.some((m) => m.role === "tool" && m.toolCallId === toolCallId);
}
