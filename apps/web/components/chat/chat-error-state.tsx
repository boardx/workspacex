"use client";

import * as React from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * 「读失败 + 重试」的统一空态。
 *
 * 抽出来是因为 issue #2052（CK-P7）要把 `RosterPanel` 搬成两条轨道共用的组件，而它
 * 内部用了这个当时私有在 `chat-read-screen.tsx` 里的小组件——原地不动就得在新模块里
 * 抄第三份。
 *
 * ⚠ 已知遗留：`personal-chat-screen.tsx:709` 还有一份自己的同名实现（本轮之前就存在
 *   的重复，不是本次引入）。本次只收敛 `chat-read-screen.tsx` 那一份，不顺手改无关
 *   组件——范围纪律。那份的收敛已另行登记。
 */
export function ErrorState({
  testId, message, retryTestId, onRetry,
}: {
  testId: string;
  message: string;
  retryTestId: string;
  onRetry: () => void;
}): JSX.Element {
  return (
    <div className="flex flex-col items-start gap-2 p-3" data-testid={testId}>
      <p className="text-12 text-destructive">{message}</p>
      <Button size="xs" variant="outline" data-testid={retryTestId} onClick={onRetry}>
        <RefreshCw aria-hidden className="h-3 w-3" />重试
      </Button>
    </div>
  );
}
