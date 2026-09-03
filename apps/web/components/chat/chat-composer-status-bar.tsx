"use client";

import * as React from "react";

/**
 * 2026-09-02 composer 重设计——卡片底部的**状态栏**。
 *
 * 此前各种状态（连接中 / 正在听 / 错误 / 发送禁用理由）是卡片外零散的红字灰字；
 * 设计稿把它们收成卡片底部一条 48px 的横条，按状态区分语气（tone）与操作：
 *   neutral（连接中、暂停、Agent 处理中）· destructive（正在听）· warning（静音、
 *   服务不可用、权限被拒）· success（转录完成）。
 * 左：图标 + 加粗标题 + 说明；右：0–3 颗操作胶囊（描边 / 实心 / 实心赭红）。
 * `testId` 由调用方给（`chat-mic-listening` 等既有状态锚点原样沿用），`role="status"`
 * + `aria-live="polite"` 让读屏软件感知状态切换（TW-A11Y-6）。
 */

export type ComposerStatusTone = "neutral" | "destructive" | "warning" | "success";

export interface ComposerStatusAction {
  readonly label: string;
  readonly onClick: () => void;
  readonly variant?: "outline" | "solid" | "solid-destructive";
  readonly disabled?: boolean;
  readonly testId?: string;
  readonly title?: string;
}

const TONE_CLASS: Record<ComposerStatusTone, string> = {
  neutral: "border-border-subtle bg-panel text-card-foreground",
  destructive: "border-destructive/20 bg-destructive/5 text-destructive",
  warning: "border-warning/30 bg-warning-tint text-warning-tint-foreground",
  success: "border-success/30 bg-success/10 text-success",
};

const ACTION_CLASS: Record<NonNullable<ComposerStatusAction["variant"]>, string> = {
  outline: "border border-border bg-panel-alt text-card-foreground hover:bg-muted",
  solid: "border border-inverse bg-inverse text-inverse-foreground hover:bg-primary-hover",
  "solid-destructive": "border border-destructive bg-destructive text-destructive-foreground hover:bg-destructive/90",
};

export function ComposerStatusBar({
  tone,
  icon,
  title,
  description,
  actions = [],
  testId,
  ...rest
}: {
  readonly tone: ComposerStatusTone;
  readonly icon: React.ReactNode;
  readonly title: React.ReactNode;
  readonly description?: React.ReactNode;
  readonly actions?: readonly ComposerStatusAction[];
  readonly testId: string;
} & Omit<React.HTMLAttributes<HTMLDivElement>, "title">): JSX.Element {
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid={testId}
      data-tone={tone}
      className={`flex min-h-12 items-center gap-2 rounded-b-xl border-t px-5 py-2 text-13 ${TONE_CLASS[tone]}`}
      {...rest}
    >
      <span aria-hidden className="flex h-4 w-4 shrink-0 items-center justify-center">{icon}</span>
      <span className="min-w-0 flex-1 truncate">
        <span className="font-medium">{title}</span>
        {description ? <span className="ml-2 opacity-80">{description}</span> : null}
      </span>
      {actions.length > 0 ? (
        <span className="flex shrink-0 items-center gap-2">
          {actions.map((action) => (
            <button
              key={action.label}
              type="button"
              data-testid={action.testId}
              title={action.title ?? action.label}
              disabled={action.disabled}
              onClick={action.onClick}
              className={`h-7 rounded-pill px-3 text-12 transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:border-transparent disabled:bg-disabled disabled:text-disabled-foreground ${ACTION_CLASS[action.variant ?? "outline"]}`}
            >
              {action.label}
            </button>
          ))}
        </span>
      ) : null}
    </div>
  );
}
