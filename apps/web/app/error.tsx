"use client";
import * as React from "react";
import { reportClientError } from "@/lib/report-client-error";

/**
 * Next.js App Router 的路由级错误边界——渲染期抛出的异常（React 组件树内）
 * 在这里被接住，而不是让整个页面白屏且什么都不上报。
 *
 * ⚠ `useEffect` 里上报，不在渲染体里：上报是一次副作用，且只在这个错误
 *   **第一次**被这个边界接住时发生一次，不随重渲染重复触发。
 * ⚠ `reportClientError` 本身不抛出、不阻塞（见该文件头）——这层不需要,
 *   也不应该等它。
 */
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    reportClientError(error);
  }, [error]);

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="text-14 font-medium">页面出了点问题</p>
      <p className="max-w-md text-12 text-muted-foreground">
        这个错误已经被自动记录，我们会去看。你可以重试，或者刷新页面。
      </p>
      <button
        type="button"
        onClick={() => reset()}
        className="mt-1 rounded-md border border-border-subtle bg-panel px-3 py-1.5 text-12 hover:bg-card"
        data-testid="app-error-boundary-retry"
      >
        重试
      </button>
    </div>
  );
}
