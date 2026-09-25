/**
 * 真实模型车道里**从浏览器打后端**的两件事：路径前缀、会话令牌。
 *
 * ## 为什么要抽出来
 *
 * 2026-09-24 → 09-25 我在同一类问题上栽了**三次**，每次都是一整轮真机跑（十几分钟）
 * 才看到结果：
 *
 *   ① `real-model-pdf-smoke` 写死 `/api/...`：devapp 有公网反代所以能过，
 *      本地 lane 没有 ⇒ Next 返回 404 的 HTML，`response.json()` 抛
 *      「Unexpected token '<'」。
 *   ② 前缀只设给了 webServer，**测试进程读不到** ⇒ 分支永远走错边。
 *   ③ `real-model-office-matrix` 改对了前缀，却用 `page.request.get` 直接打 ⇒ **401**：
 *      应用的会话令牌在 `localStorage` 里，不是 cookie，`page.request` 带不上它。
 *
 * 三次的共同点是「浏览器侧怎么正确地打一次后端」这件事**没有单一事实源**，
 * 每个 spec 各写一遍、各错一遍。这里就是那一份。
 */
import type { Page } from "@playwright/test";
import { SESSION_TOKEN_STORAGE_KEY } from "../../lib/api-client";

/**
 * 浏览器侧的后端路径。
 *
 * 后端控制器挂的是**裸路径**（`/chat/threads/...`），两条 lane 的到达方式不同：
 *   · devapp：公网反代把 `/api/*` 转给后端 ⇒ 前缀是 `/api`
 *   · 本地：Next 的同源改写（`next.config.mjs`）⇒ 前缀是 `/__fullstack_api`
 *
 * 唯一事实源是 `NEXT_PUBLIC_API_PATH_PREFIX`（`playwright.real-model-smoke.config.ts`
 * 里算一次并赋回 `process.env`，webServer 与测试进程共用）。
 */
export function apiPath(path: string): string {
  const prefix = (process.env.NEXT_PUBLIC_API_PATH_PREFIX ?? "").replace(/\/$/, "");
  const bare = path.startsWith("/") ? path : `/${path}`;
  return prefix === "" ? `/api${bare}` : `${prefix}${bare}`;
}

export interface AuthedResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly json: unknown;
}

/**
 * 带着**当前浏览器会话**打一次后端并取 JSON。
 *
 * ⚠ 必须在页面内 `fetch`，不能用 `page.request`：令牌在 `localStorage` 里，
 * `page.request` 有自己的 cookie jar、带不上 Authorization 头，结果是 401。
 * ⚠ 也刻意**不把令牌读回测试进程**——Playwright 的 `page.request` 在传输层清理失败时
 * 会把请求头写进调用日志，那会让失败产物变成一次会话令牌泄漏。
 */
export async function authedJson(page: Page, path: string): Promise<AuthedResponse> {
  return page.evaluate(async ({ storageKey, url }) => {
    const token = window.localStorage.getItem(storageKey);
    if (!token) throw new Error("AUTHENTICATED_SESSION_TOKEN_MISSING");
    const response = await window.fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const text = await response.text();
    let parsed: unknown = null;
    try { parsed = JSON.parse(text); } catch {
      // 拿回 HTML 多半是前缀错了（打到 Next 的 404 页）——把这件事说出来，
      // 而不是抛一句「Unexpected token '<'」让人再查一轮。
      throw new Error(`期待 JSON，拿回的是非 JSON（前 60 字：${text.slice(0, 60)}）`);
    }
    return { ok: response.ok, status: response.status, json: parsed };
  }, { storageKey: SESSION_TOKEN_STORAGE_KEY, url: apiPath(path) });
}

/** 取一份文件的字节（产物校验要按字节判，不能只看列表）。 */
export async function authedBytes(page: Page, path: string): Promise<Buffer> {
  const base64 = await page.evaluate(async ({ storageKey, url }) => {
    const token = window.localStorage.getItem(storageKey);
    if (!token) throw new Error("AUTHENTICATED_SESSION_TOKEN_MISSING");
    const response = await window.fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error(`取字节失败 HTTP ${String(response.status)}`);
    const buffer = await response.arrayBuffer();
    let binary = "";
    const view = new Uint8Array(buffer);
    for (const byte of view) binary += String.fromCharCode(byte);
    return window.btoa(binary);
  }, { storageKey: SESSION_TOKEN_STORAGE_KEY, url: apiPath(path) });
  return Buffer.from(base64, "base64");
}
