import * as React from "react";
import { Button } from "@/components/ui/button";

/** 七态里共用的骨架 / 空 / 错误 / 无权限占位。testid 前缀由各屏传入。 */

export function LoadingSkeleton({ testid }: { testid: string }) {
  return (
    <div data-testid={testid} className="flex flex-col gap-3 animate-pulse" aria-busy>
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="h-14 rounded-lg bg-muted" />
      ))}
    </div>
  );
}

export function EmptyState({
  testid,
  message,
  actionLabel,
  actionTestid,
  onAction,
}: {
  testid: string;
  message: string;
  actionLabel?: string;
  actionTestid?: string;
  onAction?: () => void;
}) {
  return (
    <div
      data-testid={testid}
      className="flex flex-col items-center gap-4 rounded-lg border border-dashed border-border py-12 text-center"
    >
      <p className="text-13 text-muted-foreground">{message}</p>
      {actionLabel && (
        <Button size="sm" variant="outline" data-testid={actionTestid} onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </div>
  );
}

export function ErrorState({
  testid,
  message,
  onRetry,
}: {
  testid: string;
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      data-testid={testid}
      className="flex flex-col items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4"
    >
      <p className="text-13 text-destructive">{message}</p>
      <Button size="sm" variant="outline" onClick={onRetry}>
        重试
      </Button>
    </div>
  );
}

export function DeniedState({ testid }: { testid: string }) {
  return (
    <div
      data-testid={testid}
      className="flex flex-col items-center gap-2 rounded-lg border border-border py-12 text-center"
    >
      <p className="text-14 font-medium text-background-foreground">找不到该页面</p>
      <p className="text-12 text-muted-foreground">
        该资源不存在或你没有访问权限。若需要，请联系组织管理员申请对应角色。
      </p>
    </div>
  );
}
