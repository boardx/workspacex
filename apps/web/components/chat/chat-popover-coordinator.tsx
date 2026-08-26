"use client";

import * as React from "react";

/**
 * gap #3（issue #1803，2026-08-22 真实浏览器实测，devapp）：消息面板里「运行 Agent」
 * 下拉与「加 skill」快捷挂载列表是两个各自私有 `useState<boolean>` 的浮层
 * （`AgentPicker` 在 `chat-live-message-panel.tsx` 里，`ChatSkillMountPanel` 的
 * `picking` 在自己文件里），互相不知道对方的存在——先开 Agent 下拉、不关它
 * 再点「加 skill」，两个浮层会同屏叠在一起。
 *
 * 这里不各自加「关掉另一个」的硬编码耦合（那会让两个文件互相 import 对方的
 * setState，形成本仓一贯要避免的「两份状态互相踩」），而是给「同一时刻只能有
 * 一个浮层开着」这件事起一个单一事实源：一个 Provider 持有 `activeId`，两个
 * 浮层各自把自己的 `useState(false)` 换成 `useChatPopoverSlot(id)`——谁把它
 * 设成 true，谁就抢到 `activeId`，原来占着的那个自然读到 `open === false`。
 *
 * ⚠ 找不到 Provider 时退化为本地 `useState`（不炸，也不再互斥）——这样
 *   `AgentPicker`/`ChatSkillMountPanel` 的隔离单测不必额外包一层 Provider。
 */

/**
 * issue #2130（TW-P0-2/P0-5）—— 新增两个槽位：
 *  - `chat-capability-picker`：把工具栏「选择能力」入口纳入同一互斥组
 *    （原来的 `chat-agent-picker` 是它的前身，见 `chat-task-workbench-capability-picker.tsx`）。
 *  - `chat-composer-mic-devices`：麦克风按钮的二级设备菜单，与上面两个下拉同属
 *    「同一时刻只开一个浮层」的既有纪律，不新开一套互斥逻辑。
 */
export type ChatPopoverId = "chat-agent-picker" | "chat-skill-mount" | "chat-capability-picker" | "chat-composer-mic-devices";

type ChatPopoverContextValue = {
  readonly activeId: ChatPopoverId | null;
  readonly setActiveId: React.Dispatch<React.SetStateAction<ChatPopoverId | null>>;
};

const ChatPopoverContext = React.createContext<ChatPopoverContextValue | null>(null);

export function ChatPopoverCoordinatorProvider({ children }: { children: React.ReactNode }) {
  const [activeId, setActiveId] = React.useState<ChatPopoverId | null>(null);
  const value = React.useMemo<ChatPopoverContextValue>(() => ({ activeId, setActiveId }), [activeId]);
  return <ChatPopoverContext.Provider value={value}>{children}</ChatPopoverContext.Provider>;
}

/** 与 `React.useState<boolean>` 同形状的返回值，方便原地替换调用点。 */
export function useChatPopoverSlot(id: ChatPopoverId): [boolean, React.Dispatch<React.SetStateAction<boolean>>] {
  const ctx = React.useContext(ChatPopoverContext);
  const [localOpen, setLocalOpen] = React.useState(false);

  const open = ctx ? ctx.activeId === id : localOpen;

  const setOpen = React.useCallback<React.Dispatch<React.SetStateAction<boolean>>>(
    (next) => {
      if (!ctx) {
        setLocalOpen(next);
        return;
      }
      ctx.setActiveId((prevActiveId) => {
        const prevOpen = prevActiveId === id;
        const nextOpen = typeof next === "function" ? (next as (was: boolean) => boolean)(prevOpen) : next;
        if (nextOpen) return id;
        // 只有「我自己」是当前占用者时，关闭才清空 activeId——
        // 避免一个已经是 false 的浮层再调一次 setOpen(false) 时误关了刚抢到的那个。
        return prevActiveId === id ? null : prevActiveId;
      });
    },
    [ctx, id],
  );

  return [open, setOpen];
}
