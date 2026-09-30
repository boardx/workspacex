"use client";
import * as React from "react";

/**
 * 消息流里的外来块（UIUX r1 屏 4 P0-1）：外壳要把某些块**放进消息流**而不是钉在线程头下面
 * （AG07 handoff 卡片是 Agent 的一条消息，应带头像/名字/时间出现在对话里）。
 *
 * `lead` 排在所有消息之前（例：转交新开线程的来源卡——线程的起点）；`tail` 排在所有消息之后
 * （例：Agent 本轮发出的转交请求）。任一存在时，空线程不再显示通用空态——线程已有上下文。
 * 面板 (`copilotkit-v2-panel-body.tsx`) 只负责摆放，不知道块里是什么。
 */
export interface ChatStreamSlots {
  readonly lead: React.ReactNode;
  readonly tail: React.ReactNode;
  /**
   * 空线程的首条消息草稿（例：转交新开的线程 = 交接包摘要）。面板只在输入框为空、线程还没有消息时
   * 填一次（按 `key` 去重）——重新打开线程时草稿仍在，用户已打的字从不覆盖。
   */
  readonly draftSeed?: { readonly key: string; readonly text: string } | null;
}

export const ChatStreamSlotsContext = React.createContext<ChatStreamSlots>({ lead: null, tail: null });

export function useChatStreamSlots(): ChatStreamSlots {
  return React.useContext(ChatStreamSlotsContext);
}
