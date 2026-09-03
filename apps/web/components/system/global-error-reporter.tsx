"use client";
import * as React from "react";
import { installGlobalErrorReporting } from "@/lib/report-client-error";

/**
 * 挂在根 `Providers` 里的哨兵组件——不渲染任何东西，只在挂载时安装
 * `window.onerror` / `unhandledrejection` 监听器（`installGlobalErrorReporting`
 * 本身是幂等的，见该文件）。这条路径接住的是 React 错误边界（`app/error.tsx`）
 * 之外的异常：事件回调里的同步抛出、未 catch 的 Promise 拒绝。
 */
export function GlobalErrorReporter(): null {
  React.useEffect(() => {
    installGlobalErrorReporting();
  }, []);
  return null;
}
