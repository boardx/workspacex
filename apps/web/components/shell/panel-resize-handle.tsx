"use client";

/**
 * 侧栏的拖拽把手 —— 鼠标能拖，键盘也能调。
 *
 * ## 为什么是 `role="separator"` 而不是一个 `<button>`
 *
 * WAI-ARIA 的 **window splitter** 模式：分隔条自身就是控件，带
 * `aria-valuenow/valuemin/valuemax` 与 `aria-orientation`。做成按钮的话，
 * 屏幕阅读器读到的是「按钮」而不是「当前 288，可调范围 240–720」——用户无从知道
 * 自己在调什么、调到哪了。键盘用户拿到的是同一件能力，不是一个降级替代品。
 *
 * ## 判据不在这里
 *
 * 夹取边界、指针→宽度、按键→宽度全部在 `lib/chat-workbench/panel-width.ts`（纯函数、
 * 有逐字单测）。这个组件只负责把事件接上去——jsdom 里模拟真实拖拽不可靠，
 * 把判断放进纯函数才判得动。
 */
import * as React from "react";
import {
  PANEL_WIDTH_MAX, PANEL_WIDTH_MIN, widthFromDrag, widthFromKey,
} from "@/lib/chat-workbench/panel-width";
import { cn } from "@/lib/utils";

export function PanelResizeHandle({
  edge, width, onWidthChange, label, className, testId = "panel-resize-handle",
}: {
  /** 把手贴在面板的哪条边上。右栏是 `left`（往左拖变宽）。 */
  readonly edge: "left" | "right";
  readonly width: number;
  readonly onWidthChange: (width: number) => void;
  readonly label: string;
  readonly className?: string;
  readonly testId?: string;
}): React.JSX.Element {
  const dragRef = React.useRef<{ startX: number; startWidth: number } | null>(null);
  const viewport = (): number | undefined => (typeof window === "undefined" ? undefined : window.innerWidth);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    // 只接主键/主触点；右键与多指不该改布局
    if (event.button !== 0) return;
    dragRef.current = { startX: event.clientX, startWidth: width };
    // 捕获指针：拖到面板外面、拖过其它元素都继续算这次拖拽
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    if (drag === null) return;
    onWidthChange(widthFromDrag(edge, drag.startWidth, drag.startX, event.clientX, viewport()));
  };
  const endDrag = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (dragRef.current === null) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const next = widthFromKey(edge, width, event.key, event.shiftKey, viewport());
    if (next === null) return;   // 认不出的按键：不拦默认行为（Tab 还要能走出去）
    event.preventDefault();
    onWidthChange(next);
  };

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={Math.round(width)}
      aria-valuemin={PANEL_WIDTH_MIN}
      aria-valuemax={PANEL_WIDTH_MAX}
      data-testid={testId}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
      // 双击回默认宽度——和键盘的 Enter/Space 同一个动作，鼠标用户也该有
      onDoubleClick={() => { onWidthChange(widthFromKey(edge, width, "Enter", false, viewport()) ?? width); }}
      className={cn(
        // 视觉上是一条细线，命中区比它宽（6px）——1px 的把手谁也抓不住
        "group absolute inset-y-0 z-10 w-1.5 cursor-col-resize touch-none",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        edge === "left" ? "-left-0.5" : "-right-0.5",
        className,
      )}
    >
      <span
        aria-hidden
        className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors duration-fast group-hover:bg-ring group-focus-visible:bg-ring"
      />
    </div>
  );
}
