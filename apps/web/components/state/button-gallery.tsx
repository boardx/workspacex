"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";

/**
 * 按钮样板 —— 样板页的按钮**本身就是给人点的**，所以必须有反馈。
 * 死控件检测器（scripts/lint-dead-controls.mjs）把「画了但没接线」判为缺陷：
 * 一个演示按钮点了没反应，恰恰演示不出「按下去是什么感觉」。
 */
export function ButtonGallery() {
  const [last, setLast] = React.useState<string | null>(null);
  const variants = [
    { v: "primary", label: "主行动" },
    { v: "secondary", label: "次级" },
    { v: "outline", label: "描边" },
    { v: "ghost", label: "幽灵" },
    { v: "ai", label: "交给 Ava" },
    { v: "destructive", label: "删除" },
  ] as const;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {variants.map(({ v, label }) => (
          <Button key={v} variant={v} data-testid={`demo-btn-${v}`} onClick={() => setLast(label)}>
            {label}
          </Button>
        ))}
        <Button variant="primary" disabled data-testid="demo-btn-disabled">禁用态</Button>
      </div>
      <p className="text-11 text-muted-foreground" data-testid="demo-btn-feedback" role="status">
        {last ? `刚点了：${last}` : "点一个试试——样板页的按钮都是活的"}
      </p>
    </div>
  );
}
