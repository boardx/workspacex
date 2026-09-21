/**
 * 2026-09-20（权限 review）：`/platform/*` 的同源代理 rewrite。
 *
 * ## 为什么需要这条测试
 *
 * 壳层现在每次挂载都会读 `GET /platform/access`（「我有没有平台运营准入」，决定画不画
 * 平台后台菜单）。`next.config.mjs` 里**原本没有任何 `/platform` rewrite**，于是这条请求
 * 被 Next 自己接住返回 404 HTML——fullstack e2e 的四条 spec 同时红在「零 console 错误」
 * 上（run 35498347201）。同一个缺口早就让 `GET /platform/members` 在真栈里够不到，
 * 只是没有任何东西去读它。
 *
 * `lint-rewrite-coverage` 抓不到这一类：它扫 controller 源码里的**字面量路径**，而
 * `platform-member.controller.ts` / `platform-access.controller.ts` 的路径来自契约常量
 * （`C.operations.x.path`）。那道门的盲区不在本轮修（改扫描器是另一件事），这条测试
 * 就是这个束的补丁：**路径从契约取**，所以将来契约里新增一条 `/platform/...`，
 * 它必须同样落在这个 rewrite 覆盖下，否则这里红。
 */
import { afterEach, describe, expect, it } from "vitest";
import { platformMembers } from "@repo/contracts";

// next.config is executable ESM JavaScript and intentionally has no standalone declaration file.
// @ts-expect-error exercised here as runtime configuration, not application code
import rawNextConfig from "../next.config.mjs";

type Rewrite = { readonly source: string; readonly destination: string };
const nextConfig = rawNextConfig as { rewrites(): Promise<{ readonly afterFiles: readonly Rewrite[] }> };

const ORIGINAL_ORIGIN = process.env.FULLSTACK_E2E_API_ORIGIN;

afterEach(() => {
  if (ORIGINAL_ORIGIN === undefined) delete process.env.FULLSTACK_E2E_API_ORIGIN;
  else process.env.FULLSTACK_E2E_API_ORIGIN = ORIGINAL_ORIGIN;
});

describe("platform-members 束的同源代理路由", () => {
  it("`/platform/:path*` 整段转发到真实 API（没有裸 `/platform` 路由，同 `/system` 先例）", async () => {
    process.env.FULLSTACK_E2E_API_ORIGIN = "http://127.0.0.1:3274";
    const { afterFiles } = await nextConfig.rewrites();
    expect(afterFiles.filter((r) => r.source.includes("/platform"))).toEqual([
      { source: "/__fullstack_api/platform/:path*", destination: "http://127.0.0.1:3274/platform/:path*" },
    ]);
  });

  it("契约里每一条 `/platform/...` 路由都落在这条 rewrite 的覆盖下（新增一条忘了接线会红）", async () => {
    process.env.FULLSTACK_E2E_API_ORIGIN = "http://127.0.0.1:3274";
    const { afterFiles } = await nextConfig.rewrites();
    const covered = afterFiles.map((r) => r.source);
    const paths = Object.values(platformMembers.operations).map((op) => op.path);
    // 阳性对照：束里确实有 `/platform/...` 路由，否则下面的 every 平凡为真。
    expect(paths.some((p) => p.startsWith("/platform/"))).toBe(true);
    for (const p of paths) {
      const head = p.split("/")[1];
      expect(covered, `${p} 没有对应的 rewrite —— 浏览器会拿到 Next 的 404 HTML`).toContain(
        `/__fullstack_api/${head}/:path*`,
      );
    }
  });
});
