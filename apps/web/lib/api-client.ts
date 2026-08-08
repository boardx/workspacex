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

/**
 * #466 —— 流式面（WebSocket）的源地址。
 *
 * ## 为什么它是**独立的一条**配置，而不是从 `apiBaseUrl()` 推出来的
 *
 * HTTP 面在浏览器门控里刻意走 Next 的同源改写（`NEXT_PUBLIC_API_PATH_PREFIX`），
 * 理由写在 `next.config.mjs`：把跨端口 CORS 配置扩张成产品运行时改动不划算。
 * **但 Next 的 rewrite 不代理 WebSocket 升级** —— 它是 HTTP 代理，`Upgrade` 请求
 * 到那里就断了。所以 WS 必须直连 API 源。
 *
 * 这不是「绕过 CORS」：WebSocket 本来就不受 CORS 约束，能不能连由**服务端**的握手
 * 决定（bearer 子协议 + 项目角色，见 `apps/api/src/interface/ws/asr-stream.gateway.ts`）。
 * 这里放开的是「浏览器允许去连」，而不是「服务端允许谁连」—— 后者一分没松。
 *
 * 缺省从 `apiBaseUrl()` 推（`http→ws`），单进程部署不需要多配一个变量；
 * 只有「web 与 api 不同源」的部署（本仓的全栈门控正是）才需要显式配。
 */
export function apiWebSocketUrl(path: string): string {
  const origin = process.env.NEXT_PUBLIC_API_WS_URL ?? apiBaseUrl();
  const url = new URL(path.startsWith("/") ? path : `/${path}`, origin);
  if (url.protocol === "https:") url.protocol = "wss:";
  else if (url.protocol === "http:") url.protocol = "ws:";
  return url.toString();
}

/**
 * 2026-08-08 事故（#753）—— composer 麦克风（#726）与正式录音转写（#466）点了没反应，
 * 根因是部署侧反代没有给这两条 WS 面开路由，`new WebSocket(...)` 建的连接因此永远卡在
 * 握手阶段：既不 `open` 也不 `error`，两条面各自的 `openAsrDraftStream`/`openAsrStream`
 * 里 `await new Promise((resolve, reject) => { socket.on("open"/"error", ...) })` 因此
 * 永久 pending——`.then/.catch` 都不会跑，界面上什么都不会发生，与"点了没反应"一模一样。
 *
 * `error` 事件不是网络层失败的可靠信号（有些失败模式——反代把 Upgrade 请求路由去一个
 * 不认识这条路径的 HTTP 服务器——两端都不会发一个 WS 层面的 `error` 帧，连接只是安静地
 * 半开着）。所以握手阶段**必须**有一个客户端侧的超时兜底，不能只等 `open`/`error`。
 *
 * 两条 WS 面（`live-asr-draft.ts`、`live-asr.ts`）共用这一个 helper，不各写一份计时器逻辑。
 */
export const WS_HANDSHAKE_TIMEOUT_MS = 8_000;

export function waitForSocketOpen(
  socket: WebSocket,
  onHandshakeFailed: () => Error,
  timeoutMs: number = WS_HANDSHAKE_TIMEOUT_MS,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      // 超时视为握手失败的一种：把还半开着的连接关掉，不留一条没人再理会的 socket。
      socket.close();
      reject(new Error("ws_handshake_timeout"));
    }, timeoutMs);
    socket.addEventListener("open", () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
    socket.addEventListener("error", () => {
      clearTimeout(timer);
      reject(onHandshakeFailed());
    }, { once: true });
  });
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

/** 后端统一失败信封的客户端投影：`{ error, traceId, reasonCode? }`。 */
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

/**
 * #654 阶段2d — exported for callers that need the resolved URL but NOT `apiRequest`'s
 * "parse the whole body as one JSON envelope" behaviour, e.g. a `fetch` against an SSE
 * endpoint (`agent-run-stream.ts`) that reads its response body incrementally instead.
 * Same same-origin-proxy-prefix resolution as every other real API call in this app --
 * this is not a second URL-building rule, it is this one made reusable.
 */
export function apiUrl(path: string, query?: Record<string, string | undefined>): string {
  return buildUrl(path, query);
}

function buildUrl(path: string, query?: Record<string, string | undefined>): string {
  // Full-stack browser gates keep browser traffic same-origin through an explicit proxy
  // prefix. The default is empty, so production URLs retain their signed controller paths.
  const prefix = (process.env.NEXT_PUBLIC_API_PATH_PREFIX ?? "").replace(/\/$/, "");
  const requestPath = path.startsWith("/") ? path : `/${path}`;

  // ⚠ 2026-08-05 事故：`new URL(absolutePath, base)` 会把 `base` 的路径段整个丢掉——
  // 这是 URL 构造函数的规范行为，不是 bug，但它悄悄假设了「apiBaseUrl() 只是 origin，
  // 所有路径都靠 prefix 拼」。provision.sh 曾把 NEXT_PUBLIC_API_URL 设成
  // `https://devapp.boardx.us/api`（带路径）而没配 PATH_PREFIX，于是
  // `new URL("/auth/bootstrap", "https://devapp.boardx.us/api")`
  // 变成 `https://devapp.boardx.us/auth/bootstrap` —— `/api` 被整个吃掉，
  // 线上注册页因此 404。
  //
  // ⇒ 不再依赖 URL 构造函数的 base 解析：手动拼接 origin + base 的路径段 + prefix +
  // 请求路径。无论运维把路径放在 NEXT_PUBLIC_API_URL 里还是
  // NEXT_PUBLIC_API_PATH_PREFIX 里，效果相同——这个函数不该对配置方式挑食。
  const base = new URL(apiBaseUrl());
  const basePath = base.pathname.replace(/\/$/, "");
  const url = new URL(`${basePath}${prefix}${requestPath}`, base.origin);

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
    const reasonCode = extractReasonCode(json);
    throw new ApiError(res.status, reasonCode, json);
  }
  return json as T;
}

function extractReasonCode(envelope: unknown): string | null {
  if (typeof envelope === "object" && envelope !== null && "reasonCode" in envelope) {
    const v = (envelope as { reasonCode: unknown }).reasonCode;
    return typeof v === "string" ? v : null;
  }
  return null;
}
