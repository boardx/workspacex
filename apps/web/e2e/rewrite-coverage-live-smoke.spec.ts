/**
 * #2490 —— controller 路由 ↔ `next.config.mjs` rewrites 成对的**运行时**反证。
 *
 * `lint-rewrite-coverage` 只做静态成对检查（读 controllers/ 与 next.config.mjs 的文本）。
 * 这里补上另一半：真的让 Next 同源代理（`/__fullstack_api` 前缀，fullstack-smoke 栈）
 * 收一个请求，断言它到达了 NestJS API（JSON 响应、鉴权状态码），而不是被 Next 自己
 * 接成一页 404 HTML——那正是漏 rewrite 的唯一症状（前端报 `Unexpected token '<'`）。
 *
 * 三条路径就是 #2490 补上的三条：`/tasks`（裸）、`/tasks/today`（深）、`/system/error-logs`（深）。
 * 不登录：未鉴权时 API 给 401/403 **JSON**，这已经足以区分「到了 API」与「Next 404 HTML」，
 * 且不依赖任何种子数据。最后一条是反空转：一条没接 rewrite 的路径必须真的落成 Next 404 HTML，
 * 否则前面三条的「JSON」可能是别的原因（比如代理把所有东西都转发了）。
 *
 * 为什么用 `/__fullstack_api` 前缀而不是空前缀：`apps/web/app/tasks` 是一个真实页面，
 * 这批 rewrite 在 `afterFiles`，空前缀下裸 `/tasks` 会先命中页面（与 `/projects` 并存的
 * 方式相同）；带前缀的路径没有对应页面，只能走 rewrite——要证的正是这一条。
 */
import { expect, test } from "@playwright/test";

const API = "/__fullstack_api";
const REWIRED = ["/tasks", "/tasks/today", "/system/error-logs"] as const;

test.describe("#2490 rewrite 运行时可达：Next 同源代理把路由交给 API，不是自己的 404 HTML", () => {
  for (const path of REWIRED) {
    test(`${path} 到达 API（JSON + 鉴权状态码，不是 HTML）`, async ({ request }) => {
      const res = await request.get(`${API}${path}`, { maxRedirects: 0 });
      const contentType = res.headers()["content-type"] ?? "";
      const body = await res.text();
      expect([200, 401, 403], `${path} 状态码 ${res.status()}，body: ${body.slice(0, 120)}`).toContain(res.status());
      expect(contentType, `${path} content-type`).toMatch(/application\/json/);
      expect(body.trimStart().startsWith("<"), `${path} 收到的是 HTML：${body.slice(0, 120)}`).toBe(false);
    });
  }

  test("反空转：没接 rewrite 的路径确实被 Next 接成 404 HTML", async ({ request }) => {
    const res = await request.get(`${API}/no-such-route-2490`, { maxRedirects: 0 });
    expect(res.status()).toBe(404);
    expect(res.headers()["content-type"] ?? "").toMatch(/text\/html/);
  });
});
