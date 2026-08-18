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

/**
 * 非 JSON 错误正文在 `ApiError.rawBody` 里保留的最大字符数——见 `apiRequest` 里
 * 解析失败分支的说明：上游可能吐一整页 HTML，原样保留只会淹没有用信息。
 */
const RAW_BODY_PREVIEW_CHARS = 512;

/** 后端统一失败信封的客户端投影：`{ error, traceId, reasonCode? }`。 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly reasonCode: string | null,
    readonly raw: unknown,
    /**
     * 响应正文**不是 JSON** 时保留的原始片段（截断到 `RAW_BODY_PREVIEW_CHARS`）。
     * 正常的失败信封走 `raw`，这个字段恒为 `undefined`——它只在"上游根本没按契约
     * 回 JSON"这条路径上有值，是排查网关/代理故障时唯一的线索。
     */
    readonly rawBody?: string,
  ) {
    super(reasonCode ?? `http_${status}`);
    this.name = "ApiError";
  }
}

export interface ApiRequestOptions {
  /**
   * ⚠ `PUT` 是 #881 补的：契约 `assetGovernance.writeAssetFile` 用的就是 PUT
   * （`@Put("/assets/:assetKind/:assetId/files/content")`），而此前这个联合类型里没有它
   * ——不是有意排除，是在此之前没有调用方需要。方法名以**契约**为准，
   * 不在这一层把 PUT 改写成 POST 去迁就类型。
   */
  readonly method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
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
  /**
   * ⚠ 2026-08-18 实测（真栈 + 真实百炼模型跑 pptx skill 试跑）：这里**曾经是裸的
   * `JSON.parse(text)`**，于是任何**非 JSON 的错误响应**都会让它抛一个原始
   * `SyntaxError`，且这个 SyntaxError 会一路冒到界面上。用户看到的是
   * `Unexpected token 'I', "Internal S"... is not valid JSON`——
   * 真实原因（上游 500 / 网关超时 / 代理断连）被一句 JSON 解析报错完全盖住。
   *
   * ⚠ 这不是一个理论缺口：**本文件与 `next.config.mjs` 里已经有七处以上注释**把
   * `Unexpected token '<'`（解析到 `<!DOCTYPE`）当成"rewrite 少配了"的诊断线索来用。
   * 也就是说这个症状被反复观测、反复写进注释当路标，却**从来没有人修解析本身**——
   * 它一直在把"后端/网关出错"翻译成"前端 JSON 解析 bug"，每一次都要人肉重新推理。
   *
   * 修法：解析失败**不再抛 SyntaxError**。
   * · 响应本身就是失败（`!res.ok`）⇒ 抛 `ApiError`，带上真实 status 与截断后的原始
   *   正文（`rawBody`）。界面于是显示"HTTP 500"这类可理解的错误，排查时还能看到
   *   上游到底吐了什么。
   * · 响应是 2xx 却不是 JSON ⇒ 这是真正的协议违约（rewrite 打到了 Next 自己的
   *   404 HTML 是最常见的一种），照样抛 `ApiError`，不静默返回一个假的 `undefined`。
   *
   * ⚠ 正文截断到 512 字：错误信封可能是一整页 HTML，原样塞进 Error message 只会
   *   淹没真正有用的那一行。
   */
  let json: unknown;
  let parsed = true;
  try {
    json = text.length > 0 ? JSON.parse(text) : undefined;
  } catch {
    parsed = false;
    json = undefined;
  }

  if (!parsed) {
    throw new ApiError(res.status, null, undefined, text.slice(0, RAW_BODY_PREVIEW_CHARS));
  }

  if (!res.ok) {
    const reasonCode = extractReasonCode(json);
    throw new ApiError(res.status, reasonCode, json);
  }
  return json as T;
}

/**
 * #363 delta：导出——`live-org-admin.ts` 的 `uploadOrgAvatar` 走一次手写 `fetch`
 * （契约的 `in` 只有元数据，字节走原始请求体，不能套 `apiRequest` 的「body 即 JSON」
 * 假设），但失败信封的解析规则只应该有一份，不是抄一份新的。
 */
export function extractReasonCode(envelope: unknown): string | null {
  if (typeof envelope === "object" && envelope !== null && "reasonCode" in envelope) {
    const v = (envelope as { reasonCode: unknown }).reasonCode;
    return typeof v === "string" ? v : null;
  }
  return null;
}
