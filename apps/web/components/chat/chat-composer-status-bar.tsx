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
      {/*
        * 2026-09-23 本地真栈实测：这里原来是 `truncate`。提反馈弹窗里语音报错那一句
        * 「当前环境尚未配置语音转写服务，暂时无法使用语音输入，请手动输入。」被截成
        * 「……请手动…」——被省略号吃掉的正好是告诉他下一步怎么办的那半句。
        * 状态栏是给人读完的，折行，不截。
        */}
      <span className="min-w-0 flex-1 break-words" data-testid={`${testId}-text`}>
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

/**
 * 语音出错时状态栏说什么、给哪些按钮——对话 composer 与提反馈弹窗**共用这一份**。
 *
 * 2026-09-23 之前两处各抄了一遍同样的判断，而两处都有同一个洞：不管什么原因都给「重试」。
 * 服务端说 `ASR_NOT_CONFIGURED`（这个环境根本没开通语音转写——本地版没下转写模型时就是）时，
 * 重试点多少次都一样，那个按钮是一条死路。只在**可能是暂时的**那几种失败下给重试。
 */
export function voiceErrorStatus(
  speech: { readonly status: string; readonly error: string | null; readonly errorReason: string | null },
  opts: { readonly onRetry: () => void; readonly retryTestId: string; readonly helpTestId: string },
): { readonly title: string; readonly description: string | null; readonly actions: readonly ComposerStatusAction[] } {
  const denied = speech.status === "denied";
  const unsupported = speech.status === "unsupported";
  const notConfigured = speech.errorReason === "ASR_NOT_CONFIGURED";
  const actions: ComposerStatusAction[] = [];
  if (denied) {
    actions.push({
      label: "查看如何开启",
      onClick: () => window.open("https://support.google.com/chrome/answer/2693767", "_blank", "noopener"),
      testId: opts.helpTestId,
    });
  }
  if (!unsupported && !notConfigured) actions.push({ label: "重试", onClick: opts.onRetry, variant: "solid", testId: opts.retryTestId });
  return {
    title: denied ? "浏览器未授权麦克风" : unsupported ? "此浏览器不支持语音输入" : notConfigured ? "这里还没开通语音输入" : "语音识别暂时不可用",
    description: denied ? "在地址栏左侧的站点设置中允许麦克风，然后重试" : speech.error,
    actions,
  };
}
