"use client";
import * as React from "react";
import { AlertTriangle, Inbox, Loader2, Lock, PlugZap, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { UI_STATES, UI_STATE_LABEL, RESERVED_STATE_TESTID, type UiState } from "@/lib/ui-state";
import { Button } from "@/components/ui/button";

/**
 * StateShell —— 七种必现界面状态的统一承载（UC-0.4 R3 步骤 5）
 *
 * 背景：D-36 裁定「七种必现状态 sign-off 时豁免逐屏设计，按统一规范实现」。
 * 「统一规范」在此之前没有对应的共享组件，豁免无处兑现——本组件就是那个载体。
 *
 * ⚠ 已有原型是 happy path 演示、**零异常态**。新屏一律经本组件渲染，
 *   不要各屏自己写空态/错误态，那会重现「每屏一套、都不完整」的老问题。
 *
 * testid 为**固定保留名**（D-35 命名规范），Playwright 依赖它们做七态断言：
 *   loading / empty / err-<字段> / denied / dep-failed / saved
 */
export type { UiState } from "@/lib/ui-state";
export { UI_STATES, UI_STATE_LABEL, resolvePreviewState } from "@/lib/ui-state";

interface StateShellProps {
  state: UiState;
  children: React.ReactNode;
  /** 空态的引导文案与动作 */
  emptyHint?: string;
  onCreate?: () => void;
  /** 校验失败：字段名 → 错误信息。testid 为 `err-<字段名>` */
  errors?: Record<string, string>;
  /** 依赖失败：说明是哪个依赖、以及可以怎么办 */
  depFailure?: { what: string; retry?: () => void };
  /** 无权限：必须说明是组织层还是项目层限制（UC-0.3 R8：不要只显示「无权限」） */
  denial?: { layer: "organization" | "project"; reason: string };
  successMessage?: string;
  className?: string;
  /** 骨架屏行数，按内容密度调 */
  skeletonRows?: number;
}

export function StateShell({
  state, children, emptyHint = "还没有内容", onCreate, errors, depFailure,
  denial, successMessage = "已保存", className, skeletonRows = 3,
}: StateShellProps) {
  if (state === "loading") {
    return (
      <div data-testid={RESERVED_STATE_TESTID["loading"]} className={cn("flex animate-pulse flex-col gap-3 p-4", className)}>
        {Array.from({ length: skeletonRows }).map((_, i) => (
          <div key={i} className="h-14 rounded-lg bg-muted" />
        ))}
        <span className="sr-only">加载中</span>
      </div>
    );
  }

  if (state === "empty") {
    return (
      <div
        data-testid={RESERVED_STATE_TESTID["empty"]}
        className={cn(
          "flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border py-12 text-center",
          className,
        )}
      >
        <Inbox aria-hidden className="h-6 w-6 text-muted-foreground" />
        <p className="text-13 text-muted-foreground">{emptyHint}</p>
        {onCreate && (
          <Button size="sm" variant="primary" onClick={onCreate} data-testid="empty-create-action">
            新建
          </Button>
        )}
      </div>
    );
  }

  if (state === "invalid") {
    const entries = Object.entries(errors ?? { form: "请检查输入内容" });
    return (
      <div className={cn("flex flex-col gap-3", className)}>
        {children}
        <div className="flex flex-col gap-1 rounded-md border border-destructive/30 bg-destructive/5 p-3">
          {entries.map(([field, msg]) => (
            <p key={field} role="alert" data-testid={`${RESERVED_STATE_TESTID.invalid}${field}`} className="text-12 text-destructive">
              {msg}
            </p>
          ))}
        </div>
      </div>
    );
  }

  if (state === "dep-failed") {
    return (
      <div
        data-testid={RESERVED_STATE_TESTID["dep-failed"]}
        role="alert"
        className={cn(
          "flex flex-col items-center gap-3 rounded-lg border border-warning/30 bg-warning/5 py-10 text-center",
          className,
        )}
      >
        <PlugZap aria-hidden className="h-6 w-6 text-warning" />
        <div className="flex flex-col gap-1">
          <p className="text-13 font-medium">依赖不可用</p>
          <p className="text-12 text-muted-foreground">
            {depFailure?.what ?? "上游服务暂时不可用"}
          </p>
        </div>
        {depFailure?.retry && (
          <Button size="sm" variant="outline" onClick={depFailure.retry} data-testid="dep-failed-retry">
            重试
          </Button>
        )}
      </div>
    );
  }

  if (state === "denied") {
    // UC-0.3 R8：被拒绝时要给出可理解的原因（是组织层还是项目层限制），不要只显示「无权限」。
    // 且不得泄露资源是否存在（R6 失败后置条件）。
    return (
      <div
        data-testid={RESERVED_STATE_TESTID["denied"]}
        role="alert"
        className={cn(
          "flex flex-col items-center gap-3 rounded-lg border border-border bg-muted py-10 text-center",
          className,
        )}
      >
        <Lock aria-hidden className="h-6 w-6 text-muted-foreground" />
        <div className="flex flex-col gap-1">
          <p className="text-13 font-medium">你没有查看这块内容的权限</p>
          <p className="text-12 text-muted-foreground" data-testid="denied-layer">
            {denial?.layer === "organization"
              ? `组织层限制：${denial.reason}`
              : `项目层限制：${denial?.reason ?? "你在本项目中没有对应的角色"}`}
          </p>
        </div>
      </div>
    );
  }

  if (state === "success") {
    return (
      <div className={cn("flex flex-col gap-3", className)}>
        {children}
        <p
          data-testid={RESERVED_STATE_TESTID["success"]}
          className="inline-flex items-center gap-1 text-12 text-success transition-opacity duration-300"
        >
          <Check aria-hidden className="h-3.5 w-3.5" />
          {successMessage}
        </p>
      </div>
    );
  }

  return <div className={className}>{children}</div>;
}

/** 开发/预览环境的状态切换器。⚠ 生产构建不渲染（UC-0.4 R9 / R12 V8） */
export function StatePreviewSwitcher({ current }: { current: UiState }) {
  if (process.env.NODE_ENV === "production") return null;
  return (
    <div
      data-testid="state-preview-switcher"
      className="flex flex-wrap items-center gap-1 rounded-md border border-border-subtle bg-panel p-1"
    >
      <span className="px-1 text-10 uppercase tracking-wide text-muted-foreground">预览状态</span>
      {UI_STATES.map((s) => (
        <Button
          key={s}
          asChild
          size="xs"
          variant={s === current ? "primary" : "ghost"}
          data-testid={`state-switch-${s}`}
        >
          <a href={`?state=${s}`}>{UI_STATE_LABEL[s]}</a>
        </Button>
      ))}
    </div>
  );
}


const AlertIcon = AlertTriangle;
const Spinner = Loader2;
export { AlertIcon, Spinner };
