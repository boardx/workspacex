/**
 * issue #3246 —— 用**真组件的盒模型常量**渲出「图标导航栏 + 底部通知铃铛 + 展开的
 * 弹层」的静态 DOM，供 `chat-rail-notifications-geometry.spec.ts` 在真浏览器里量几何。
 *
 * ## 为什么不是直接渲 `IconRail` / `TaskNotifications`
 * 两者都是 client 组件：`IconRail` 要 Next 的 `usePathname`，`TaskNotifications` 的
 * 展开态是内部 `useState` + 一次 `/notifications` 请求。在一个 `renderToStaticMarkup`
 * 的 Node 进程里既没有路由也没有事件循环去点开它。
 *
 * ## 那量的还是"真几何"吗——是
 * 决定几何的四样东西（nav 盒子、底部段盒子、trigger 盒子、弹层盒子）在实现里已经收敛成
 * `RAIL_NAV_CLASS` / `RAIL_BOTTOM_CLASS` / `NOTIFICATIONS_TRIGGER_CLASS` /
 * `NOTIFICATIONS_POPOVER_*_CLASS` 四个**导出常量**，本夹具直接引用它们，不抄第二份。
 * 谁把展开方向改回向下、把宽度改窄、或者给 nav 加回 `overflow-hidden`，这里量到的
 * 数字立刻变——这正是本仓「同一事实不得声明在两处」的用法，不是替身。
 *
 * 用法：node --import tsx e2e/fixtures/rail-notifications-fixture.tsx <输出 html 路径>
 */
import * as React from "react";
import { writeFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { RAIL_NAV_CLASS, RAIL_BOTTOM_CLASS } from "@/components/shell/icon-rail";
import {
  NOTIFICATIONS_POPOVER_BASE_CLASS, NOTIFICATIONS_POPOVER_CLASS, NOTIFICATIONS_TRIGGER_CLASS,
} from "@/components/chat/workbench/task-notifications";

const ITEMS = Array.from({ length: 24 }, (_, i) => `任务提醒 ${i + 1} · 一条足够长的标题用来把弹层撑到高度上限`);

const markup = renderToStaticMarkup(
  <nav data-testid="shell-rail" className={RAIL_NAV_CLASS}>
    <div data-testid="rail-scroll" className="scrollbar-none flex min-h-0 w-full flex-1 flex-col items-center overflow-y-auto">
      {["对话", "编排", "项目", "研究", "访谈", "录音", "问卷", "设计", "能力", "大脑", "任务", "治理"].map((label) => (
        <span key={label} className="mt-1.5 flex w-14 shrink-0 flex-col items-center gap-1 rounded-md py-1.5 text-10">{label}</span>
      ))}
    </div>
    <div data-testid="rail-bottom" className={RAIL_BOTTOM_CLASS}>
      <div className="relative flex w-full flex-col items-center" data-testid="task-notifications" data-variant="rail">
        <button type="button" data-testid="task-notifications-trigger" className={NOTIFICATIONS_TRIGGER_CLASS.rail}>
          <span className="relative flex items-center justify-center">
            <span className="block h-4 w-4" />
            <span data-testid="task-notifications-badge" className="absolute -right-2 -top-1.5 min-w-4 rounded-full bg-destructive px-1 text-10 leading-4 text-destructive-foreground">7</span>
          </span>
          <span className="text-10">提醒</span>
        </button>
        <div
          data-testid="task-notifications-popover"
          className={`${NOTIFICATIONS_POPOVER_BASE_CLASS} ${NOTIFICATIONS_POPOVER_CLASS.rail}`}
        >
          {ITEMS.map((title) => (
            <div key={title} data-testid="notification-item" className="w-full whitespace-normal py-1 text-left text-12">{title}</div>
          ))}
        </div>
      </div>
      <span data-testid="rail-feedback" className="mt-1.5 flex w-14 flex-col items-center gap-1 rounded-md py-1.5 text-10">反馈</span>
      <span data-testid="rail-profile-menu" className="mt-1.5 flex h-8 w-8 items-center justify-center rounded-md">U</span>
    </div>
  </nav>,
);

writeFileSync(
  process.argv[2]!,
  `<html><head><link rel="stylesheet" href="out.css"></head><body class="bg-background" style="margin:0"><div style="height:100vh;display:flex">${markup}</div></body></html>`,
);
