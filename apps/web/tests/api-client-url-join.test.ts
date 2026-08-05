/**
 * 2026-08-05 事故：`buildUrl` 用 `new URL(absolutePath, base)` 拼 URL。那个 API
 * 会把 `base` 的**路径段整个丢掉**——不是 bug，是规范行为，但它悄悄假设了
 * `apiBaseUrl()` 只是 origin。VM 的 `provision.sh` 曾把
 * `NEXT_PUBLIC_API_URL` 设成 `https://devapp.boardx.us/api`（带路径）而没配
 * `NEXT_PUBLIC_API_PATH_PREFIX`，于是：
 *
 *   new URL("/auth/bootstrap", "https://devapp.boardx.us/api")
 *   → "https://devapp.boardx.us/auth/bootstrap"      ← /api 被整个吃掉
 *
 * 线上注册页因此 404（`创建服务暂时不可用`）。
 *
 * ⇒ 本文件钉住三种配置形状都必须拼出同一个正确 URL —— `buildUrl` 不该对
 *   「路径放在 API_URL 里」还是「放在 PATH_PREFIX 里」挑食。
 *
 * `buildUrl` 本身未导出（内部实现细节），所以这里经真实入口 `apiRequest`
 * 断言它实际 fetch 的 URL，而不是把内部函数导出来单测。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

async function capturedUrl(path: string): Promise<string> {
  vi.resetModules();
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({}), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  const { apiRequest } = await import("@/lib/api-client");
  await apiRequest(path, { sessionToken: null }).catch(() => {});
  const call = fetchMock.mock.calls[0] as unknown as [string];
  return call[0];
}

describe("api-client buildUrl：base 的路径段不得被吞掉", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("① 路径塞进 NEXT_PUBLIC_API_URL（provision.sh 曾经的写法）—— 事故复现的配置", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "https://devapp.boardx.us/api");
    vi.stubEnv("NEXT_PUBLIC_API_PATH_PREFIX", "");
    expect(await capturedUrl("/auth/bootstrap")).toBe(
      "https://devapp.boardx.us/api/auth/bootstrap",
    );
  });

  it("② origin-only + 显式 PATH_PREFIX —— 修复后 provision.sh 的推荐写法", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "https://devapp.boardx.us");
    vi.stubEnv("NEXT_PUBLIC_API_PATH_PREFIX", "/api");
    expect(await capturedUrl("/auth/bootstrap")).toBe(
      "https://devapp.boardx.us/api/auth/bootstrap",
    );
  });

  it("③ 本地开发缺省：origin-only，无 prefix ——正样本，证明①②不是靠巧合绿的", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "http://localhost:3200");
    vi.stubEnv("NEXT_PUBLIC_API_PATH_PREFIX", "");
    expect(await capturedUrl("/auth/bootstrap")).toBe("http://localhost:3200/auth/bootstrap");
  });
});
