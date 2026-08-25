"use client";

import * as React from "react";
import { Check, Mic } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { useChatPopoverSlot } from "@/components/chat/chat-popover-coordinator";
import type { GetAgentPanelOut } from "@/lib/live-chat";

/*
  拆自 `chat-live-message-panel.tsx`（业务源文件规模纪律：接近 2000 行硬上限时
  必须按领域职责拆分，见 AGENTS.md「不可违反的硬约束」）。这两个组件是 composer
  行里的两个手搓下拉——「运行 Agent」与「麦克风设备」，彼此独立、只依赖
  props 与通用 UI 原语，没有引用宿主文件里的其它状态，属于干净可拆的一块。
  行为、testid、注释原样搬运，不是重写。
*/

/**
 * 运行 Agent 选择器。
 *
 * ⚠ 不用原生 `<select>`——app 层禁止裸原生表单元素（uiux-standards U6），
 *   且 #728 D8 判据逐字写「没有裸 `<select>`」。仿照本仓已有的手写弹层惯例
 *   （`components/projects/project-more-menu.tsx`：Button 触发 + `role="listbox"` 面板，
 *   不是 `@radix-ui/react-select`，虽然那个依赖已装但本仓这类小面板一贯手写）。
 *
 * `data-testid="chat-agent-select"` 留在**触发按钮**上（原来在 `<select>` 本身），
 * 值用可见文字呈现（Agent 名），不再是 `<option>` 的 `value`——
 * `toHaveValue()` 断言因此改成 `toHaveTextContent()`，`selectOption()` 改成点开+点选项。
 * 这不是削弱断言：它验证的还是「当前选中的 agent 是谁」，只是读取方式跟着控件形态换了。
 */
export function AgentPicker({
  agents, selectedAgentId, disabled, onSelect, side = "up",
}: {
  agents: GetAgentPanelOut["agents"] | null;
  selectedAgentId: string;
  disabled: boolean;
  onSelect: (agentId: string) => void;
  /**
   * 弹层展开方向。默认 "up"（`bottom-8`）——为旧屏底部 composer 设计，菜单向上弹。
   * 2026-08-25 人类 devapp 实测 bug：copilotkit-v2 把本控件放进了**顶栏**，向上弹
   * 直接出屏不可见——顶部放置传 "down"（`top-8`）向下弹。默认值保持 "up" 是为了
   * 旧调用方（chat-live-message-panel）行为逐字节不变。
   */
  side?: "up" | "down";
}) {
  const [open, setOpen] = useChatPopoverSlot("chat-agent-picker");
  const containerRef = React.useRef<HTMLDivElement>(null);
  const selected = agents?.find((agent) => agent.id === selectedAgentId) ?? null;

  /*
    issue #1803 gap #2（devapp 实测)——此前 `open` 只由触发按钮/选项的 onClick
    置位，没有 outside-click / Escape 关闭，只能再点一次触发按钮才关，不符合
    标准下拉交互预期。仿本仓已有同类浮层的写法（`components/shell/org-menu.tsx`、
    `components/shell/personal-menu.tsx`、`components/org-admin/org-admin-screen.tsx`：
    `containerRef` + `document.addEventListener("mousedown"/"keydown")`），不发明新模式。
  */
  React.useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, setOpen]);

  return (
    /*
      #728 —— 紧凑化：从「运行 Agent [长按钮撑满一行]」改成 Claude Code 那种
      左下角小触发器（头像/缩写 + 名字，不再有单独的标签行）。默认已经选中
      `agents[0]`（见调用方 `selectedAgentId` 的推导），用户多数时候不需要点开它，
      所以给它的视觉权重降到跟麦克风、发送同一级，而不是占一整行。
    */
    <div ref={containerRef} className="relative flex items-center">
      <Button
        type="button"
        size="xs"
        variant="ghost"
        className="max-w-40 justify-start gap-1.5 rounded-full px-2"
        data-testid="chat-agent-select"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="运行 Agent"
        title={selected ? `运行 Agent：${selected.name}` : "运行 Agent"}
        onClick={() => setOpen((value) => !value)}
      >
        {selected ? <Avatar initials={selected.abbr} tone="ai" size="xs" /> : null}
        <span className="truncate text-11">{selected?.name ?? (agents?.length ? "选择 Agent" : "没有可选 Agent")}</span>
        <span aria-hidden className="text-9 text-muted-foreground">▾</span>
      </Button>
      {open && agents?.length ? (
        <div
          role="listbox"
          aria-label="运行 Agent"
          data-testid="chat-agent-select-listbox"
          className={`absolute ${side === "down" ? "top-8" : "bottom-8"} left-0 z-10 w-48 rounded-lg border border-border bg-popover p-1 shadow-md`}
        >
          {agents.map((agent) => (
            <button
              key={agent.id}
              type="button"
              role="option"
              aria-selected={agent.id === selectedAgentId}
              data-testid={`chat-agent-select-option-${agent.id}`}
              onClick={() => {
                onSelect(agent.id);
                setOpen(false);
              }}
              className={[
                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-12 transition-colors duration-base hover:bg-muted active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                agent.id === selectedAgentId ? "text-primary" : "text-card-foreground",
              ].join(" ")}
            >
              <Avatar initials={agent.abbr} tone="ai" size="xs" />
              <span className="truncate">{agent.name}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * realtime-asr 增补 A（contract.md §7）：composer 麦克风的输入设备下拉。
 *
 * 仿 `AgentPicker` 的手搓 listbox（本仓没有下拉基元库）。三条诚实约束（§7.3）：
 *  - 未授权 → label 为空 → 显示占位「麦克风 N（授权后显示名称）」，不空白也不编名；
 *  - 「系统默认」永远是第一项、选中态由 `selectedDeviceId === null` 表示；
 *  - 选中项打勾（`Check`）。热插拔刷新与记忆在 `useAudioInputDevices` 里，这里只渲染。
 */
export function MicDevicePicker({
  devices, selectedDeviceId, disabled, onSelect,
}: {
  devices: readonly { readonly deviceId: string; readonly label: string }[];
  selectedDeviceId: string | null;
  disabled: boolean;
  onSelect: (deviceId: string | null) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const labelFor = (deviceId: string, label: string, index: number): string =>
    label !== "" ? label : `麦克风 ${index + 1}（授权后显示名称）`;
  const selected = devices.find((device) => device.deviceId === selectedDeviceId) ?? null;
  const triggerText = selectedDeviceId === null
    ? "系统默认麦克风"
    : (selected ? labelFor(selected.deviceId, selected.label, devices.indexOf(selected)) : "系统默认麦克风");

  return (
    <div className="relative flex items-center">
      <Button
        type="button"
        size="xs"
        variant="ghost"
        className="max-w-40 justify-start gap-1.5 rounded-full px-2"
        data-testid="chat-mic-device-select"
        data-selected-device={selectedDeviceId ?? ""}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="选择麦克风"
        title={`麦克风：${triggerText}`}
        onClick={() => setOpen((value) => !value)}
      >
        <Mic aria-hidden className="h-3 w-3 text-muted-foreground" />
        <span className="truncate text-11">{triggerText}</span>
        <span aria-hidden className="text-9 text-muted-foreground">▾</span>
      </Button>
      {open ? (
        <div
          role="listbox"
          aria-label="选择麦克风"
          data-testid="chat-mic-device-listbox"
          className="absolute bottom-8 left-0 z-10 w-56 rounded-lg border border-border bg-popover p-1 shadow-md"
        >
          {/* 「系统默认」恒为第一项：不选具体设备就跟随系统，这是 deviceId=null 的语义。 */}
          <button
            type="button"
            role="option"
            aria-selected={selectedDeviceId === null}
            data-testid="chat-mic-device-option-default"
            onClick={() => { onSelect(null); setOpen(false); }}
            className={[
              "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-12 transition-colors duration-base hover:bg-muted active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              selectedDeviceId === null ? "text-primary" : "text-card-foreground",
            ].join(" ")}
          >
            <Check aria-hidden className={["h-3 w-3 shrink-0", selectedDeviceId === null ? "opacity-100" : "opacity-0"].join(" ")} />
            <span className="truncate">系统默认麦克风</span>
          </button>
          {devices.length === 0 ? (
            <p className="px-2 py-1.5 text-11 text-muted-foreground" data-testid="chat-mic-device-empty">
              未检测到其它输入设备。授权麦克风后会显示设备名。
            </p>
          ) : null}
          {devices.map((device, index) => {
            const isSelected = device.deviceId === selectedDeviceId;
            return (
              <button
                key={device.deviceId}
                type="button"
                role="option"
                aria-selected={isSelected}
                data-testid={`chat-mic-device-option-${device.deviceId}`}
                onClick={() => { onSelect(device.deviceId); setOpen(false); }}
                className={[
                  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-12 transition-colors duration-base hover:bg-muted active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  isSelected ? "text-primary" : "text-card-foreground",
                ].join(" ")}
              >
                <Check aria-hidden className={["h-3 w-3 shrink-0", isSelected ? "opacity-100" : "opacity-0"].join(" ")} />
                <span className="truncate">{labelFor(device.deviceId, device.label, index)}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
