import * as React from "react";
import { Bot } from "lucide-react";
import { Card } from "@/components/ui/card";

/**
 * 三种 HITL 中断卡共用的外壳 —— 把卡片放进「线程里的同事」这一 AI 在场方式
 * （既有产品心智，见 uiux-standards「AI 四种在场方式」）。视觉/骨架与既有
 * `SendEmailApprovalDialog` 同源：shadcn Card + 头像 + 标题 + 说明，token 一致。
 *
 * ⚠ 黑白灰为主，唯一彩色是 --danger；AI 在场用中性头像而非彩色徽记，
 *   与本轮导入的新 UX 重设计一致（见 ui-preview README 的设计决定登记）。
 */
export function InterruptCardShell({
  testid,
  title,
  subtitle,
  children,
}: {
  testid: string;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="w-full max-w-[34rem]" data-testid={`${testid}-shell`}>
      <div className="flex items-start gap-2.5 border-b border-border-subtle p-3">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border bg-muted">
          <Bot aria-hidden className="h-4 w-4 text-muted-foreground" />
        </span>
        <div className="flex flex-col gap-0.5">
          <span className="text-13 font-bold tracking-tight text-card-foreground">{title}</span>
          {subtitle ? <span className="text-11 text-muted-foreground">{subtitle}</span> : null}
        </div>
      </div>
      <div className="p-3">{children}</div>
    </Card>
  );
}
