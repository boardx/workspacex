"use client";
import * as React from "react";

/**
 * 审批弹窗关闭后把焦点还回去（TW-A11Y-5）。
 *
 * ## 为什么 Radix 的默认行为在这里不成立
 *
 * Radix Dialog 默认把焦点还给「打开前的 `document.activeElement`」——那个约定成立的
 * 前提是**用户点了一个 trigger 才打开**。工作台的审批弹窗不是：它由 **Agent 发起**，
 * 组件挂载时 `open` 就是 `true`，而此刻用户手上那个元素往往已经不在了
 * （发送按钮在运行中会被禁用/换成「停止」，焦点被浏览器丢回 `BODY`）。
 * 于是 Esc 关闭后焦点落在 `BODY`，键盘用户被弹回文档开头——2026-09-07 真栈实测
 * （`chat-task-workbench-a11y.spec.ts` TW-A11Y-5，实测落点 `BODY`）。
 *
 * ## 为什么挂在 `onCloseAutoFocus` 而不是 Esc 的按键处理上
 *
 * 「关闭」有多条路径：Esc、右上角关闭按钮、点遮罩、以及表单提交后的程序化关闭。
 * 只补 Esc 那一条，下一个人换条路径就会再踩一次同一个坑。`onCloseAutoFocus` 是
 * Radix 对**所有**关闭路径的统一收口，落点只在这里声明一次。
 *
 * 落点顺序：① 打开前那个仍然可聚焦的元素（真有 trigger 的场景，如「打开待确认请求」
 * 按钮）；② 否则回到用户真正在工作的地方——工作台输入框；③ 两者都拿不到就
 * **不拦截**，把默认行为交还给 Radix（不制造一个更奇怪的落点）。
 */

/** 工作台输入框锚点。与 e2e 的 `copilotkit-v2-input` 是同一个事实，这里只引用不新造。 */
const COMPOSER_SELECTOR = '[data-testid="copilotkit-v2-input"]';

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button",
  "input",
  "select",
  "textarea",
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(",");

/** `BODY` 不算落点：`focus()` 到它等于没还焦点，正是这条判据要拦的失败形态。 */
function focusableOrNull(element: Element | null | undefined): HTMLElement | null {
  if (!(element instanceof HTMLElement)) return null;
  if (!element.isConnected || element === document.body) return null;
  if (!element.matches(FOCUSABLE_SELECTOR)) return null;
  if (element.hasAttribute("disabled") || element.getAttribute("aria-hidden") === "true") return null;
  // `checkVisibility` 在真实浏览器里连 display/visibility/content-visibility 一起判；
  // jsdom 没有这个方法（也没有布局），此时不假装能判可见性，直接放行。
  if (typeof element.checkVisibility === "function" && !element.checkVisibility()) return null;
  return element;
}

export function useDialogReturnFocus(open: boolean): (event: Event) => void {
  const openedFrom = React.useRef<HTMLElement | null>(null);
  React.useEffect(() => {
    if (!open) return;
    openedFrom.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }, [open]);

  return React.useCallback((event: Event) => {
    const target =
      focusableOrNull(openedFrom.current)
      ?? focusableOrNull(document.querySelector(COMPOSER_SELECTOR));
    if (!target) return;
    event.preventDefault();
    target.focus();
  }, []);
}
