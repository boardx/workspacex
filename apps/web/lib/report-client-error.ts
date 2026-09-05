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
 *   3. `copilotkit-v2-panel-body.tsx` 的 `copilotkit.subscribe({ onError })` 订阅与
 *      `send()` 的 `catch` 分支（issue #2797）——chat/agent-run 失败此前只有
 *      `console.error` 诊断日志（PR #2783），排查全靠人工截图 DevTools。这条路径
 *      额外带上 `runId`/`threadId`/`phase`/`errorType`（见 `ClientErrorReportContext`），
 *      前两条路径没有"属于哪一次 run"这个上下文,四个字段都省略。
 *
 * 三条路径最终都调用本文件的 `reportClientError`，不是各写一份 `fetch`——
 * 上报的字段形状、截断规则只在这里定义一次。
 *
 * ## 为什么上报**从不**抛出、**从不**阻塞调用方
 *
 * 上报本身是诊断意图之外的第二件事：一次异常已经发生，上报失败（网络断了、
 * 后端也在这次故障里）绝不能变成用户看到的第二个错误，也不能让错误边界的渲染
 * 因为等一个网络请求而卡住。`void`、`.catch(() => undefined)`，与后端
 * `AllExceptionsFilter` 里 `errorLog.record()` 的纪律逐字相同。
 *
 * ## 每个字段的长度上限**逐字**对应契约 `system-error-logs.ts` 的 `.max()`
 *
 * review finding（PR #2475）：这里曾经是 `s.slice(0, max) + suffix`——截断后的
 * 长度是 `max + suffix.length`，**必然超过**契约的 `.max(2000)`，于是上报的正是
 * "客户端认为需要截断"的那批最该被看见的超长异常，静默 400 后被 `.catch()` 吞掉。
 * 现在的 `truncate` 保证**加上后缀之后**的总长度不超过 `max`——与服务端
 * `error-log.port.ts` 的 `redactErrorDetail`/`truncate` 是同一种保证，
 * 两处各自实现是因为分属前后端两个运行时，不是同一份代码能跨进程复用的场景。
 */
import { apiRequest } from "./api-client";

// ⚠ 与 `@repo/contracts` 的 `system-error-logs.ts`.`operations.reportClientError.in`
//   逐字一致——那份 `.max()` 是唯一事实源，这里的常量只是让截断在**发送前**发生，
//   而不是让请求体超限、指望服务端的 400 来发现。
const MAX_MESSAGE_LEN = 2000;
const MAX_STACK_LEN = 8000;
const MAX_URL_LEN = 2000;
const MAX_USER_AGENT_LEN = 500;
const MAX_APP_VERSION_LEN = 100;
// issue #2797 -- chat/agent-run 关联字段,逐字对应契约新增的四个 `.max()`。
const MAX_RUN_ID_LEN = 200;
const MAX_THREAD_ID_LEN = 200;
const MAX_PHASE_LEN = 100;
const MAX_ERROR_TYPE_LEN = 200;

const TRUNCATED_SUFFIX = "…[TRUNCATED]";

/** 截断后（含后缀）的总长度不超过 `max`——见文件头 review finding。 */
function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  const keep = Math.max(0, max - TRUNCATED_SUFFIX.length);
  return `${s.slice(0, keep)}${TRUNCATED_SUFFIX}`;
}

/** `null` 通过原样，非空字符串按 `max` 截断——上报里好几个字段都是这个形状。 */
function truncateNullable(s: string | null, max: number): string | null {
  return s === null ? null : truncate(s, max);
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
 * issue #2797 -- chat/agent-run 报错的关联上下文,四个字段全部可选。调用方（本次是
 * `copilotkit-v2-panel-body.tsx` 的 `onError` 订阅与 `send()` 的 `catch` 分支）传它们
 * 各自当下能拿到的真实值；不知道就整体省略（不是"两条既有捕获路径都要多学一套 API"，
 * 是同一个 `reportClientError` 多接受一个可选的第二参数）。字段形状逐字对应契约
 * `system-error-logs.ts` 里 `reportClientError.in` 新增的那四个 `.optional().nullable()`。
 */
export interface ClientErrorReportContext {
  /** 出错时所属 agent run 的真实 `agent_runs.id`；没有在途 run 时省略或传 `null`。 */
  readonly runId?: string | null;
  /** 出错时所属 chat 线程 id；新对话第一轮尚未有线程 id 时省略或传 `null`。 */
  readonly threadId?: string | null;
  /** 出错那一刻的宏观运行阶段（如 `RunStage`）;没有真实阶段信号时省略或传 `null`。 */
  readonly phase?: string | null;
  /** 稳定错误码/异常类型（如 `MODEL_CALL_FAILED`/`runAgent_exception`）。 */
  readonly errorType?: string | null;
}

/**
 * 上报一次前端异常。**永不抛出**（见文件头）——调用方不需要、也不应该 `await` 它
 * 的失败分支，`void reportClientError(err)` 是唯一正确的调用形态。
 */
export function reportClientError(err: unknown, context?: ClientErrorReportContext): void {
  const report = normaliseError(err);
  void apiRequest("/system/client-error-reports", {
    method: "POST",
    body: {
      message: report.message,
      stack: truncateNullable(report.stack, MAX_STACK_LEN),
      url: truncateNullable(report.url, MAX_URL_LEN),
      userAgent: truncateNullable(typeof navigator === "undefined" ? null : navigator.userAgent, MAX_USER_AGENT_LEN),
      appVersion: truncateNullable(process.env.NEXT_PUBLIC_APP_VERSION ?? null, MAX_APP_VERSION_LEN),
      runId: truncateNullable(context?.runId ?? null, MAX_RUN_ID_LEN),
      threadId: truncateNullable(context?.threadId ?? null, MAX_THREAD_ID_LEN),
      phase: truncateNullable(context?.phase ?? null, MAX_PHASE_LEN),
      errorType: truncateNullable(context?.errorType ?? null, MAX_ERROR_TYPE_LEN),
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
