/**
 * 前端异常自动捕获 → 上报 `POST /system/client-error-reports`（契约
 * `systemErrorLogs.operations.reportClientError`，`@Public()`，无需登录）。
 *
 * ## 三条捕获路径，一份上报函数
 *
 *   1. `app/error.tsx` / `app/global-error.tsx`——Next.js App Router 的路由级错误
 *      边界，接住渲染期抛出的异常（React 组件树内）。
 *   2. `installGlobalErrorReporting()`——`window.onerror` / `unhandledrejection`，
 *      接住边界之外的异常：事件回调里的同步抛出、未 catch 的 Promise 拒绝。
 *
 * 两条路径最终都调用本文件的 `reportClientError`，不是各写一份 `fetch`——
 * 上报的字段形状、截断规则只在这里定义一次。
 *
 * ## 为什么上报**从不**抛出、**从不**阻塞调用方
 *
 * 上报本身是诊断意图之外的第二件事：一次异常已经发生，上报失败（网络断了、
 * 后端也在这次故障里）绝不能变成用户看到的第二个错误，也不能让错误边界的渲染
 * 因为等一个网络请求而卡住。`void`、`.catch(() => undefined)`，与后端
 * `AllExceptionsFilter` 里 `errorLog.record()` 的纪律逐字相同。
 */
import { apiRequest } from "./api-client";

const MAX_MESSAGE_LEN = 2000;
const MAX_STACK_LEN = 8000;

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max)}…[TRUNCATED]`;
}

export interface ClientErrorReport {
  readonly message: string;
  readonly stack: string | null;
  readonly url: string | null;
}

/** 从任意 catch 到的值（`Error` 或非 `Error`）里提炼出可上报的字段。 */
function normaliseError(err: unknown): ClientErrorReport {
  if (err instanceof Error) {
    return {
      message: truncate(err.message || err.name || "Error", MAX_MESSAGE_LEN),
      stack: err.stack ? truncate(err.stack, MAX_STACK_LEN) : null,
      url: typeof window === "undefined" ? null : window.location.href,
    };
  }
  return {
    message: truncate(typeof err === "string" ? err : String(err), MAX_MESSAGE_LEN),
    stack: null,
    url: typeof window === "undefined" ? null : window.location.href,
  };
}

/**
 * 上报一次前端异常。**永不抛出**（见文件头）——调用方不需要、也不应该 `await` 它
 * 的失败分支，`void reportClientError(err)` 是唯一正确的调用形态。
 */
export function reportClientError(err: unknown): void {
  const report = normaliseError(err);
  void apiRequest("/system/client-error-reports", {
    method: "POST",
    body: {
      message: report.message,
      stack: report.stack,
      url: report.url,
      userAgent: typeof navigator === "undefined" ? null : navigator.userAgent,
      appVersion: process.env.NEXT_PUBLIC_APP_VERSION ?? null,
    },
  }).catch(() => undefined);
}

let installed = false;

/**
 * 挂 `window.onerror` / `unhandledrejection`，接住 React 错误边界之外的异常。
 *
 * ⚠ 幂等——`GlobalErrorReporter`（挂在根 `Providers` 里）在严格模式下可能被
 *   `useEffect` 调用两次，重复挂监听器会导致同一个异常被上报两次。
 */
export function installGlobalErrorReporting(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;

  window.addEventListener("error", (event: ErrorEvent) => {
    reportClientError(event.error ?? event.message);
  });
  window.addEventListener("unhandledrejection", (event: PromiseRejectionEvent) => {
    reportClientError(event.reason);
  });
}
