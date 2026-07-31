/**
 * F122 —— 全仓第一个真实 API 客户端。
 *
 * 在这个文件之前，`apps/web` 里没有任何一处 `fetch(` 打到真实后端
 * （已用 `grep -rln "fetch(\|axios" app components lib` 核实过，全部是静态 mock 导入）。
 * 本文件是让「填表单 → 提交 → 刷新列表 → 看到它」这条端到端路径成立的最小基础设施。
 *
 * ## 刻意不引入新依赖
 *
 * 不加 axios / swr / react-query——`fetch` 够用，`apps/web/package.json` 的
 * dependencies 里不该为了一个薄封装多一行。
 *
 * ## 鉴权：Bearer token，不是 cookie
 *
 * 后端的真实解析器是 `SessionTokenPrincipalResolver`
 * （`apps/api/src/infrastructure/auth/session-token-principal-resolver.ts`）：
 * 从 `Authorization: Bearer <token>` 读 token，**没有**任何 cookie 机制。
 * `credentials: "include"` 仍然带上（对同源/未来接入 cookie 的部署无害），
 * 但真正携带身份的是这里手动加的 `Authorization` 头，token 来自
 * `POST /auth/login` 的响应，由调用方（页面）存进 `localStorage` 后传给本客户端。
 *
 * ## API 源地址
 *
 * `NEXT_PUBLIC_API_URL`，缺省 `http://localhost:3200`（`apps/api/src/main.ts`
 * 的默认端口）。`NEXT_PUBLIC_` 前缀是 Next.js 把它编译进客户端 bundle 的唯一方式。
 */
const DEFAULT_API_URL = "http://localhost:3200";

export function apiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? DEFAULT_API_URL;
}

export const SESSION_TOKEN_STORAGE_KEY = "wsx.sessionToken";

export function getStoredSessionToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(SESSION_TOKEN_STORAGE_KEY);
}

export function storeSessionToken(token: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(SESSION_TOKEN_STORAGE_KEY, token);
}

export function clearStoredSessionToken(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(SESSION_TOKEN_STORAGE_KEY);
}

/**
 * 后端失败信封的最小形状。控制器统一抛 `{ reasonCode }`（见
 * `apps/api/src/interface/controllers/project.controller.ts` 的 catch 分支），
 * Nest 的默认异常过滤器把它包进 `{ statusCode, message }`，`message` 就是那个对象。
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly reasonCode: string | null,
    readonly raw: unknown,
  ) {
    super(reasonCode ?? `http_${status}`);
    this.name = "ApiError";
  }
}

export interface ApiRequestOptions {
  readonly method?: "GET" | "POST" | "PATCH" | "DELETE";
  readonly query?: Record<string, string | undefined>;
  readonly body?: unknown;
  /** 缺省读 `localStorage`；测试或需要显式传 token 的调用方可以覆盖。 */
  readonly sessionToken?: string | null;
}

function buildUrl(path: string, query?: Record<string, string | undefined>): string {
  const url = new URL(path, apiBaseUrl());
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined) url.searchParams.set(k, v);
    }
  }
  return url.toString();
}

/** 统一的 JSON 请求 + 错误信封解析。所有真实 API 调用都应该经过这里，而不是各自 `fetch`。 */
export async function apiRequest<T>(path: string, opts: ApiRequestOptions = {}): Promise<T> {
  const token = opts.sessionToken !== undefined ? opts.sessionToken : getStoredSessionToken();
  const headers: Record<string, string> = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";

  const res = await fetch(buildUrl(path, opts.query), {
    method: opts.method ?? "GET",
    headers,
    credentials: "include",
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });

  const text = await res.text();
  const json: unknown = text.length > 0 ? JSON.parse(text) : undefined;

  if (!res.ok) {
    const reasonCode =
      json && typeof json === "object" && "message" in json
        ? extractReasonCode((json as { message: unknown }).message)
        : null;
    throw new ApiError(res.status, reasonCode, json);
  }
  return json as T;
}

/** Nest 的默认异常体是 `{ statusCode, message }`；`message` 可能是我们抛的
 *  `{ reasonCode }`，也可能是普通字符串（比如 `ContractValidationError`）。 */
function extractReasonCode(message: unknown): string | null {
  if (typeof message === "object" && message !== null && "reasonCode" in message) {
    const v = (message as { reasonCode: unknown }).reasonCode;
    return typeof v === "string" ? v : null;
  }
  return null;
}
