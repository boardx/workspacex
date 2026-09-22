/**
 * issue #3492：`/canvas/:path*` 这条通配 rewrite 把**前端画布屏**也代理到了 API。
 *
 * ## 这道门防的是什么
 *
 * `app/canvas/[screen]/page.tsx` 是**动态路由**，而 Next 的 `afterFiles` rewrites 在
 * 「静态文件/静态路由之后、**动态路由之前**」匹配（官方文档明写的顺序，
 * `next.config.mjs` 里 #2021 那条注释也逐字记过同一个坑）。于是
 * `/canvas/template-admin` 先被 `/canvas/:path*` 捞走代理到 API，浏览器整页刷新
 * 拿到的是 API 的 `{"error":"not_found"}` **JSON 文档**，而不是页面——
 * 症状与 #2021（`/chat/:path*` 吃掉 `/chat/copilotkit-v2/[threadId]`）逐字同型。
 *
 * ⚠ 这个形态只在**同源代理前缀为空**（`CHAT_READ_E2E_API_ORIGIN`）的部署里成立：
 *   `FULLSTACK_E2E_API_ORIGIN` 那套的 `prefix` 是 `/__fullstack_api`，rewrite 的
 *   `source` 根本撞不上真实页面路径。issue #3492 实测的 25022 端口就是前者。
 *
 * ## 判据：第一条命中的规则不许指向 API
 *
 * `afterFiles` 按声明顺序匹配。命中一条 `destination` 带 protocol 的规则 ⇒ 直接代理
 * 并结束路由（`resolve-routes.js`：`parsedDestination.protocol` → `return { finished: true }`）；
 * 命中一条内部 `destination` ⇒ 该 rewrite 带 `check: true`
 * （`router-utils/filesystem.js` 的 `buildCustomRoute` 对 `type === "rewrite"` 无条件加），
 * 于是立刻走动态路由解析并命中 `app/canvas/[screen]/page.tsx`。
 * 所以「这个屏会不会变成 JSON 404」= 「第一条命中它的规则是不是指向 apiOrigin」。
 *
 * 屏清单从 `lib/canvas-screens.ts` 取（唯一事实源）：将来加第七个屏却忘了在
 * `next.config.mjs` 里放行，这里会红。
 */
import { afterEach, describe, expect, it } from "vitest";
import { getPathMatch } from "next/dist/shared/lib/router/utils/path-match";
import { canvas } from "@repo/contracts";
import { CANVAS_SCREENS } from "../lib/canvas-screens";

// next.config is executable ESM JavaScript and intentionally has no standalone declaration file.
// @ts-expect-error exercised here as runtime configuration, not application code
import rawNextConfig from "../next.config.mjs";

type Rewrite = { readonly source: string; readonly destination: string };
const nextConfig = rawNextConfig as { rewrites(): Promise<{ readonly afterFiles: readonly Rewrite[] }> };

const API_ORIGIN = "http://127.0.0.1:3274";
const ORIGINAL_ORIGIN = process.env.CHAT_READ_E2E_API_ORIGIN;
const ORIGINAL_FULLSTACK = process.env.FULLSTACK_E2E_API_ORIGIN;

afterEach(() => {
  if (ORIGINAL_ORIGIN === undefined) delete process.env.CHAT_READ_E2E_API_ORIGIN;
  else process.env.CHAT_READ_E2E_API_ORIGIN = ORIGINAL_ORIGIN;
  if (ORIGINAL_FULLSTACK === undefined) delete process.env.FULLSTACK_E2E_API_ORIGIN;
  else process.env.FULLSTACK_E2E_API_ORIGIN = ORIGINAL_FULLSTACK;
});

/** 同源代理部署（`prefix` 为空串）的 afterFiles 规则表——issue #3492 复现的那一套。 */
async function sameOriginAfterFiles(): Promise<readonly Rewrite[]> {
  delete process.env.FULLSTACK_E2E_API_ORIGIN;
  process.env.CHAT_READ_E2E_API_ORIGIN = API_ORIGIN;
  const { afterFiles } = await nextConfig.rewrites();
  return afterFiles;
}

/** 按声明顺序找第一条命中该 pathname 的规则；匹配器参数与 Next 自己的 `buildCustomRoute` 一致。 */
function firstMatch(rules: readonly Rewrite[], pathname: string): Rewrite | undefined {
  return rules.find((rule) =>
    getPathMatch(rule.source, { strict: true, removeUnnamedParams: true })(pathname) !== false);
}

const proxiesToApi = (rule: Rewrite | undefined): boolean =>
  rule !== undefined && rule.destination.startsWith(API_ORIGIN);

describe("canvas 屏的前端路由不被同源代理吃掉（#3492）", () => {
  it("六个屏都不会被代理到 API（否则整页刷新拿到 JSON 404 而不是页面）", async () => {
    const rules = await sameOriginAfterFiles();
    // 阳性对照：规则表确实装着 canvas 的代理规则，否则下面的断言平凡为真。
    expect(rules.some((r) => r.source.startsWith("/canvas/"))).toBe(true);

    for (const screen of CANVAS_SCREENS) {
      const hit = firstMatch(rules, `/canvas/${screen.id}`);
      expect(
        proxiesToApi(hit),
        `/canvas/${screen.id} 被 \`${hit?.source}\` 代理到了 ${hit?.destination}`
          + "——它是 app/canvas/[screen]/page.tsx 的前端页面，会返回 API 的 JSON 404",
      ).toBe(false);
    }
  });

  it("契约里每一条 `/canvas/...` API 路由仍然被代理到真实 API（放行不许放过头）", async () => {
    const rules = await sameOriginAfterFiles();
    const paths = Object.values(canvas.operations)
      .map((op) => op.path)
      .filter((p) => p.startsWith("/canvas/"));
    // 阳性对照：契约里确实有 `/canvas/...` 操作。
    expect(paths.length).toBeGreaterThan(0);

    for (const path of paths) {
      // `:param` 段填一个具体值，才能当真实 pathname 去匹配。
      const concrete = path.split("/").map((seg) => (seg.startsWith(":") ? "sample" : seg)).join("/");
      const hit = firstMatch(rules, concrete);
      expect(
        proxiesToApi(hit),
        `${path} 没有落在任何指向 API 的 rewrite 上——浏览器会拿到 Next 的 404 HTML`,
      ).toBe(true);
    }
  });
});
