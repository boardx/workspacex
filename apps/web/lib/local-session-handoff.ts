/**
 * WorkspaceX Local（桌面版）免登录：桌面主进程自己调 `POST /auth/login`（账号是它生成的），
 * 把契约里的 `LoginOut` 原样放进登录页 URL 的 fragment（`#wsx-local-session=<base64url json>`），
 * 登录页的 `LocalSessionHandoff` 取出来走**与表单登录同一条** `session.startSession` → 跳转。
 *
 * 为什么是 fragment 而不是 localStorage 注入：会话在 localStorage 里是三把钥匙（元数据 / bearer /
 * commit 修订号）按固定顺序落盘的（`session-provider.tsx`），在 Electron 里再写一遍就是第二份
 * 副本，早晚漂移；fragment 不上服务器日志，也不会进 RSC/prefetch。
 * 为什么不是密码：URL 里只放已签发的会话，桌面进程持有的密码不出主进程。
 */
import { auth } from "@repo/contracts";
import type { z } from "zod";

export const LOCAL_SESSION_HASH_KEY = "wsx-local-session";
export type LoginOut = z.infer<typeof auth.operations.login.out>;

export function encodeLocalSessionHash(login: LoginOut): string {
  const bytes = new TextEncoder().encode(JSON.stringify(login));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  const b64 = typeof btoa === "function" ? btoa(bin) : Buffer.from(bin, "binary").toString("base64");
  return `#${LOCAL_SESSION_HASH_KEY}=${b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
}

/** `null` when the hash is absent, malformed or not a valid `LoginOut` -- never throws. */
export function parseLocalSessionHash(hash: string): LoginOut | null {
  const prefix = `#${LOCAL_SESSION_HASH_KEY}=`;
  if (!hash.startsWith(prefix)) return null;
  try {
    const json = new TextDecoder().decode(base64urlToBytes(hash.slice(prefix.length)));
    const parsed = auth.operations.login.out.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function base64urlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
  const bin = typeof atob === "function" ? atob(b64) : Buffer.from(b64, "base64").toString("binary");
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
