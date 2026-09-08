/**
 * HTTP 请求流水 → `DebugTracePort`（issue #3082）。
 *
 * Express 中间件而不是 Nest interceptor，理由与 `trace.ts` 逐字相同：interceptor 在 guard
 * 之后，被 guard 拒掉的请求就没有记录——而 401/403 的流水恰恰是排「为什么这个用户看不到
 * 数据」时最先要看的。挂在 `traceMiddleware` 之后，所以 `req.traceId` 已经有了。
 *
 * ## 两种事件
 * - `http.request`：响应结束（`finish`）或连接断开（`close` 未 finish）时记一条，带
 *   method / 路由 / 状态码 / 耗时 / userId；4xx 记 `warn`，5xx 记 `error`，慢于
 *   `slowMs` 的成功请求也记 `warn`。
 * - `http.request.stalled`：一个请求超过 `stallMs` 还没结束就**立即**记一条（不等它结束）。
 *   #2873 里 `POST /threads` 挂满 15 分钟——一个永远不结束的请求在只记 `finish` 的流水里
 *   是**不存在**的，这条事件就是为它准备的。飞行中的请求列表也从这里来
 *   （`GET /system/debug/status`）。
 *
 * ## 哪些不记
 * `GET /health*`、`/ok` 之类探针每几秒一次，全记只会淹没有用信息；默认跳过 2xx 探针，
 * 非 2xx 探针仍记（探针失败本身就是线索）。
 */
import type { NextFunction, Request, Response } from "express";
import type { DebugTracePort } from "../../application/ports/debug-trace.port";
import type { Principal } from "../../domain/principal";
import { traceIdOf } from "./trace";

export interface DebugRequestRecorderOptions {
  readonly slowMs?: number;
  readonly stallMs?: number;
  /** 2xx 时跳过的路径前缀。 */
  readonly quietPrefixes?: readonly string[];
  readonly now?: () => number;
}

export interface InFlightRequest {
  readonly traceId: string;
  readonly method: string;
  readonly path: string;
  readonly ageMs: number;
}

const QUIET_PATH_PREFIXES = ["/health", "/ok", "/system/debug/"];

function routePathOf(req: Request): string {
  const route = (req as Request & { route?: { path?: string } }).route?.path;
  if (typeof route === "string" && route !== "") return `${req.baseUrl ?? ""}${route}`;
  return (req.originalUrl ?? req.url ?? "").split("?")[0] ?? "";
}

export class DebugRequestRecorder {
  private readonly slowMs: number;
  private readonly stallMs: number;
  private readonly quiet: readonly string[];
  private readonly now: () => number;
  private readonly inFlight = new Map<string, { method: string; path: string; startedAt: number }>();

  constructor(private readonly trace: DebugTracePort, opts: DebugRequestRecorderOptions = {}) {
    this.slowMs = opts.slowMs ?? 2_000;
    this.stallMs = opts.stallMs ?? 15_000;
    this.quiet = opts.quietPrefixes ?? QUIET_PATH_PREFIXES;
    this.now = opts.now ?? (() => Date.now());
  }

  inFlightRequests(): InFlightRequest[] {
    const t = this.now();
    return [...this.inFlight.entries()]
      .map(([traceId, r]) => ({ traceId, method: r.method, path: r.path, ageMs: t - r.startedAt }))
      .sort((a, b) => b.ageMs - a.ageMs);
  }

  middleware = (req: Request, res: Response, next: NextFunction): void => {
    const traceId = traceIdOf(req);
    const startedAt = this.now();
    const method = req.method;
    const rawPath = (req.originalUrl ?? req.url ?? "").split("?")[0] ?? "";
    this.inFlight.set(traceId, { method, path: rawPath, startedAt });

    let done = false;
    const stallTimer = setTimeout(() => {
      if (done) return;
      const principal = (req as Request & { principal?: Principal }).principal;
      this.safeRecord({
        traceId, kind: "http.request.stalled", level: "warn",
        msg: `${method} ${rawPath} still running after ${this.stallMs}ms`,
        data: { method, path: rawPath },
        durationMs: this.now() - startedAt,
        userId: principal?.userId ?? null, orgId: principal?.orgId ?? null,
      });
    }, this.stallMs);
    stallTimer.unref?.();

    const finish = (aborted: boolean): void => {
      if (done) return;
      done = true;
      clearTimeout(stallTimer);
      this.inFlight.delete(traceId);
      const durationMs = this.now() - startedAt;
      const status = aborted ? 0 : res.statusCode;
      const path = routePathOf(req);
      const isQuiet = this.quiet.some((p) => rawPath === p || rawPath.startsWith(p));
      if (isQuiet && status >= 200 && status < 400 && durationMs < this.slowMs) return;
      const level = aborted || status >= 500 ? "error" : status >= 400 || durationMs >= this.slowMs ? "warn" : "info";
      const principal = (req as Request & { principal?: Principal }).principal;
      this.safeRecord({
        traceId, kind: "http.request", level,
        msg: aborted ? `${method} ${path} aborted by client after ${durationMs}ms` : `${method} ${path} -> ${status} (${durationMs}ms)`,
        data: { method, path, url: rawPath, status, aborted, contentLength: res.getHeader?.("content-length") ?? null },
        durationMs,
        userId: principal?.userId ?? null, orgId: principal?.orgId ?? null,
      });
    };
    res.on("finish", () => finish(false));
    res.on("close", () => finish(!res.writableFinished));
    next();
  };

  private safeRecord(input: Parameters<DebugTracePort["record"]>[0]): void {
    try {
      this.trace.record(input);
    } catch {
      // 记录器永远不能搞坏请求路径——见 debug-trace.port.ts 头注第 1 条。
    }
  }
}

/** DI token——`kernel.module.ts` 提供，`main.ts` 取出来 `app.use`，控制器取出来读飞行中请求。 */
export const DEBUG_REQUEST_RECORDER = Symbol("DebugRequestRecorder");
