import { describe, expect, it } from "vitest";
import {
  CHAT_READ_E2E_ORG_ADMIN,
  revokeAllStandingToolGrants,
  type StandingGrantFetch,
} from "../e2e/standing-tool-grant-cleanup";

/**
 * issue #3072 ③ / #3068 —— chat-read 夹具收尾撤销「以后都允许」的反证。
 *
 * e2e 真栈这一层的判据由 coordinator 派发的 main 全量 run 提供（本地不起 docker /
 * 真栈）。这里能证、也必须证的是**协议本身**：撤销确实发出去了、按 grantId 寻址、
 * 用的是 DELETE 而不是"列一遍就当清过了"。没有这一条，helper 可以整个是空操作而
 * 所有门控保持绿色——正是 #3072 已经踩过的那类假绿。
 */

interface Call { readonly url: string; readonly method: string; readonly headers: Record<string, string> }

function stubFetch(rows: readonly { grantId: string }[], calls: Call[], deleteStatus = 200): StandingGrantFetch {
  return async (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers });
    if (url.endsWith("/auth/login")) {
      expect(JSON.parse(init.body!)).toEqual({ ...CHAT_READ_E2E_ORG_ADMIN });
      return { ok: true, status: 200, json: async () => ({ sessionToken: "token-admin" }) };
    }
    if (init.method === "GET") return { ok: true, status: 200, json: async () => rows };
    return { ok: deleteStatus < 400, status: deleteStatus, json: async () => ({}) };
  };
}

describe("revokeAllStandingToolGrants", () => {
  it("按 grantId 逐条发 DELETE，带 admin 会话的 bearer", async () => {
    const calls: Call[] = [];
    const revoked = await revokeAllStandingToolGrants(
      "http://web.test",
      stubFetch([{ grantId: "grant-1" }, { grantId: "grant-2" }], calls),
    );

    expect(revoked).toEqual(["grant-1", "grant-2"]);
    const deletes = calls.filter((c) => c.method === "DELETE");
    expect(deletes.map((c) => c.url)).toEqual([
      "http://web.test/tool-permission-grants/grant-1",
      "http://web.test/tool-permission-grants/grant-2",
    ]);
    for (const call of deletes) expect(call.headers.authorization).toBe("Bearer token-admin");
    expect(calls.find((c) => c.method === "GET")?.url).toBe("http://web.test/tool-permission-grants");
  });

  it("组织本来就干净时不发任何 DELETE", async () => {
    const calls: Call[] = [];
    expect(await revokeAllStandingToolGrants("http://web.test", stubFetch([], calls))).toEqual([]);
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
  });

  it("撤销失败要抛，不能静默当作清干净了", async () => {
    const calls: Call[] = [];
    await expect(
      revokeAllStandingToolGrants("http://web.test", stubFetch([{ grantId: "grant-1" }], calls, 503)),
    ).rejects.toThrow(/grant-1/);
  });

  it("404（别处已撤掉同一行）不算失败", async () => {
    const calls: Call[] = [];
    expect(
      await revokeAllStandingToolGrants("http://web.test", stubFetch([{ grantId: "grant-1" }], calls, 404)),
    ).toEqual(["grant-1"]);
  });

  it("登录失败要抛——拿不到 admin 身份时清理什么都没做，不能显得像做过", async () => {
    const failing: StandingGrantFetch = async () => ({ ok: false, status: 401, json: async () => ({}) });
    await expect(revokeAllStandingToolGrants("http://web.test", failing)).rejects.toThrow(/HTTP 401/);
  });
});
