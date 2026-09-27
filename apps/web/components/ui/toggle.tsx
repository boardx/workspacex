"use client";
import * as React from "react";
import { cn } from "@/lib/utils";

/** 开关。用 token 对表达开/关，不用 opacity */
export function Toggle({
  checked, onCheckedChange, label, id, className, ...props
}:{ checked: boolean; onCheckedChange: (v: boolean) => void; label: string; id?: string } & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onChange">) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-label={label}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "group",
        "relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-all duration-200",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
        checked ? "bg-primary" : "bg-muted",
        // 禁用态走 token（uiux-standards §1.1，不用 opacity）：否则禁用的「开」和可点的「开」一模一样（#4247）
        "disabled:cursor-not-allowed disabled:bg-disabled",
        // 调用方的 className 只追加（如 mt-0.5），不能整串顶掉轨道 / 尺寸 / 颜色（#4247：开关只剩一个白点）
        className,
      )}
      {...props}
    >
      <span
        className={cn(
          "inline-block h-3 w-3 rounded-full bg-card shadow-sm transition-all duration-200",
          // 禁用时轨道变浅灰，白色旋钮在上面几乎看不见，开 / 关就只能靠位置却看不出位置；
          // 旋钮换成禁用字色 token（与禁用底 5.9:1），位置即是值（只读页面据此读出当前状态）。
          "group-disabled:bg-disabled-foreground",
          checked ? "translate-x-3.5" : "translate-x-0.5",
        )}
      />
    </button>
  );
}
