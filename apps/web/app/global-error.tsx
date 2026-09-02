"use client";
import * as React from "react";
import { reportClientError } from "@/lib/report-client-error";

/**
 * Next.js 的**根**错误边界——只在根 `layout.tsx` 自己抛出时才会渲染（例如
 * `Providers` 挂载失败）。这种情况下 `app/error.tsx` 不会被触发（它假设
 * layout 本身是好的），且**这个组件必须自带 `<html>`/`<body>`**——它替换的
 * 是整个根布局，不是布局内的某个子树。
 *
 * 正因为是根布局都没起来，`Providers` 里的 `GlobalErrorReporter` 从未挂载过，
 * 所以这里必须重复调用一次 `reportClientError`——不是复制上报逻辑（那份逻辑
 * 仍只在 `lib/report-client-error.ts` 定义一次），只是这一处必须自己触发它。
 */
export default function GlobalError({
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
    <html lang="zh-CN">
      <body>
        <div style={{ display: "flex", minHeight: "100vh", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, padding: 24, textAlign: "center", fontFamily: "sans-serif" }}>
          <p style={{ fontSize: 14, fontWeight: 500 }}>应用启动时出了点问题</p>
          <p style={{ maxWidth: 420, fontSize: 12, color: "#6b7280" }}>
            这个错误已经被自动记录。你可以重试，或者刷新页面。
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{ marginTop: 4, borderRadius: 6, border: "1px solid #d1d5db", background: "#fff", padding: "6px 12px", fontSize: 12, cursor: "pointer" }}
            data-testid="app-global-error-boundary-retry"
          >
            重试
          </button>
        </div>
      </body>
    </html>
  );
}
