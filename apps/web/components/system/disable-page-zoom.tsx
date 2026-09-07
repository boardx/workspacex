"use client";
import * as React from "react";

/**
 * 挂在根 `Providers` 里的哨兵组件——不渲染任何东西，只在挂载时安装事件监听器，
 * 阻止用户意外缩放整个网页。
 *
 * 两条独立的手势路径，缺一不可：
 *   1. Mac trackpad 双指捏合（pinch）在 Chrome/Edge/Firefox 上会派发成
 *      `wheel` 事件、附带 `ctrlKey: true`（这是浏览器把"捏合"映射成"Ctrl+滚轮缩放"
 *      的既有行为，不是真的按了 Ctrl 键）——键盘 Ctrl+滚轮缩放也走同一路径，一并挡掉。
 *      必须用 `{ passive: false }` 监听才能 `preventDefault()`，被动监听器
 *      拦不住浏览器默认动作。
 *   2. Safari 对 trackpad 捏合走的是它私有的 `gesturestart`/`gesturechange`/
 *      `gestureend` 事件（不在标准 `wheel` 路径上），需要单独挡。
 *
 * 触屏设备的双指捏合缩放不走以上两条事件路径，由 `globals.css` 里 html/body 的
 * `touch-action` 一起处理（同一件"禁止整页缩放"的事，一份在 CSS 挡触屏手势，
 * 一份在这里挡桌面 trackpad/键盘手势，不是重复实现）。
 */
export function DisablePageZoom(): null {
  React.useEffect(() => {
    const preventCtrlWheelZoom = (event: WheelEvent) => {
      if (event.ctrlKey) {
        event.preventDefault();
      }
    };
    const preventSafariGesture = (event: Event) => {
      event.preventDefault();
    };

    window.addEventListener("wheel", preventCtrlWheelZoom, { passive: false });
    // Safari 专有事件，标准 TS lib.dom 里没有类型声明，其他浏览器直接忽略这几个事件名。
    window.addEventListener("gesturestart", preventSafariGesture as EventListener);
    window.addEventListener("gesturechange", preventSafariGesture as EventListener);
    window.addEventListener("gestureend", preventSafariGesture as EventListener);

    return () => {
      window.removeEventListener("wheel", preventCtrlWheelZoom);
      window.removeEventListener("gesturestart", preventSafariGesture as EventListener);
      window.removeEventListener("gesturechange", preventSafariGesture as EventListener);
      window.removeEventListener("gestureend", preventSafariGesture as EventListener);
    };
  }, []);
  return null;
}
