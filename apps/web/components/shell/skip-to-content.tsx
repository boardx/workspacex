"use client";

/**
 * 「跳到主要内容」——键盘用户的第一条快捷路。
 *
 * ## 实测出来的问题（2026-09-23，真实安装版）
 * ```
 * 可聚焦元素总数   124
 * 消息输入框排在   第 113 位
 * 跳转链接数       0
 * ```
 * 也就是说**键盘用户要按 113 次 Tab 才能开始打字**——要先穿过整条会话列表
 * （光它自己就 30 个可聚焦项）。评分卡维度 8 的 9 分判据是「全功能键盘可达」：
 * 技术上可达，实际上不可用。
 *
 * ## 为什么是跳转链接而不是给会话列表加 `tabindex="-1"`
 * 把列表从 Tab 序里摘掉，等于让键盘用户**没法切换会话**——那是把一个可达性问题
 * 换成另一个。跳转链接是这件事的标准解法：给一条快捷路，不动原来的顺序。
 *
 * ## 为什么它平时看不见、聚焦时才出现
 * 这是它的常规形态：鼠标用户永远不会 Tab 到它，所以对他们不占任何视觉预算；
 * 键盘用户第一下 Tab 就拿到它。**不要用 `display:none` 或 `visibility:hidden`
 * 来藏**——那两种会把它从 Tab 序里一起摘掉，链接就永远不可能被聚焦到。
 */

import * as React from "react";

/** 内容区容器的 id。**这份 id 只声明在这里**，壳层引用它，不要在两处各写一个字面量。 */
export const MAIN_CONTENT_ID = "wsx-main-content";

export function SkipToContent(): React.ReactElement {
  return (
    <a
      href={`#${MAIN_CONTENT_ID}`}
      data-testid="skip-to-content"
      onClick={(e) => {
        // 只靠 `href="#id"` 在 SPA 里不够：浏览器会滚过去，但**焦点未必跟过去**，
        // 于是用户按下一个 Tab 时又回到了链接后面，等于没跳。显式把焦点挪过去。
        e.preventDefault();
        const el = document.getElementById(MAIN_CONTENT_ID);
        if (el === null) return;
        el.setAttribute("tabindex", "-1");   // 容器本身不在 Tab 序里，但要能接住焦点
        el.focus();
        // jsdom 没有 `scrollIntoView`，而焦点已经挪过去了——滚动只是锦上添花，
        // 不能因为它不存在就让整个跳转抛错。
        el.scrollIntoView?.({ block: "start" });
      }}
      className={
        // 平时挪出视口而不是隐藏——隐藏会把它从 Tab 序里一起摘掉。
        "absolute left-2 top-2 z-[100] -translate-y-[200%] rounded-md bg-primary px-3 py-1.5 "
        + "text-13 font-medium text-primary-foreground shadow-lg transition-transform "
        + "focus:translate-y-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      }
    >
      跳到主要内容
    </a>
  );
}
