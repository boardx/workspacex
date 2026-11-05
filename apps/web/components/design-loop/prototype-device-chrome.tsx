"use client";

import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";

/** 居中手机屏：有树渲染树；没有（还没生成）显示占位块，与 B4.5 之前的外观一致。 */
/**
 * 迭代 14 —— 机身外观。**只画壳，不参与布局**：状态栏/灵动岛/home 条都是绝对定位或
 * 固定高度的兄弟节点，原型内容仍占满剩余空间。
 *
 * ⚠ 这些是**装饰**，不是原语。它们不进 `data-proto`、不可选中、不进导出的 class 比对
 * （V47 比的是原语树）——把它们做成可选中的节点会让「选中一个节点去改」多出一批
 * 用户根本改不了的目标。
 */
export function StatusBar({ label }: { label: string }) {
  return (
    <div className="flex shrink-0 items-center justify-between px-5 pt-1.5 text-9 font-medium text-card-foreground/80" aria-hidden data-chrome="status">
      <span>9:41</span>
      {/* 页名：比「9:41」淡一档，但不能低于 AA——45% 时浅色原型上只有 2.99（#4331 U5，普通用户评测集量出）。
          70% ⇒ 浅色 6.8 / 深色 8.1。 */}
      <span className="truncate px-2 text-card-foreground/70">{label}</span>
      <span className="flex items-center gap-0.5">
        <span className="inline-block h-1.5 w-2.5 rounded-sm bg-current opacity-70" />
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-current opacity-70" />
        <span className="inline-block h-1.5 w-3 rounded-sm border border-current opacity-70" />
      </span>
    </div>
  );
}

/** 灵动岛（新机型）/ 听筒条（旧机型）。两者都是黑色，靠形状区分。 */
export function PhoneNotch({ island }: { island: boolean }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-1 flex justify-center" aria-hidden data-chrome={island ? "island" : "notch"}>
      <span className={cn("bg-black", island ? "h-4 w-20 rounded-full" : "h-3.5 w-32 rounded-b-xl")} />
    </div>
  );
}

/** 底部的 home 指示条。iPad 也有。 */
export function HomeIndicator() {
  return (
    <div className="flex shrink-0 justify-center pb-1.5 pt-1" aria-hidden data-chrome="home">
      <span className="h-1 w-24 rounded-full bg-card-foreground/30" />
    </div>
  );
}

/** 浏览器壳：红黄绿 + 地址栏。地址栏里放页标签——它就是这一页的"标题"。 */
export function BrowserBar({ label }: { label: string }) {
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-border bg-panel px-2.5 py-1.5" data-chrome="browser">
      {/*
        * 交通灯用**语义 token** 而不是 macOS 那三个字面色值：色相语义正好对得上
        * （危险/警告/成功），而字面色值在浅色/深色两套主题下都不会跟着变——
        * 模拟要的是"像个浏览器窗口"，不是"像素级复刻 macOS"。
        */}
      <span className="flex gap-1" aria-hidden>
        <span className="h-2 w-2 rounded-full bg-destructive" />
        <span className="h-2 w-2 rounded-full bg-warning" />
        <span className="h-2 w-2 rounded-full bg-success" />
      </span>
      <span className="flex min-w-0 flex-1 items-center gap-1 rounded-full bg-background px-2 py-0.5 text-9 text-muted-foreground">
        <Lock aria-hidden className="h-2 w-2 shrink-0" />
        <span className="truncate">{label}</span>
      </span>
    </div>
  );
}

