// rewrite-shadow.test.ts — #610 的反证。
//
// ⚠ 与 rewrite-coverage.test.ts 同一条纪律：**全部喂固定 fixture**，不读仓库真实文件。
// 理由逐字沿用那份：被断言的分支必须在任何环境下都真的被执行到，否则修没修是同一个结果。
// 对真实仓库的扫描由 lint-rewrite-coverage.mjs 承担，那是另一回事
// （反向的端到端反证在 ../lint-rewrite-shadow.test.ts 里，真的 spawn 脚本）。
//
// 用例挑选：这些不是编出来的形状，是本仓真实栽过的三次的最小复现——
//   ① #610 原始现场：`/admin/:path*` 吃掉 app/admin/[module]/page.tsx；
//   ② #3492 / PR #3806：`/canvas/:path*` 吃掉 app/canvas/[screen]/page.tsx，
//      以及「补上放行规则之后必须转绿、棘轮条目必须被判陈旧」两个方向；
//   ③ #2021 的解法：通配收窄成命名空间枚举之后，`/chat/[threadId]` 有逃生路径。
import { describe, expect, it } from "vitest";
import {
  analyzeRewriteShadow,
  parsePageRoute,
  staleShadowAllowlistEntries,
  type RewriteRuleFact,
  type ShadowInput,
} from "./rewrite-shadow";

const API = "http://127.0.0.1:65535";
const toApi = (source: string): RewriteRuleFact =>
  ({ source, destination: `${API}${source}`, conditional: false });
/** #3492 / PR #3806 那批「放行前端屏」的规则：destination 是内部路径，不带 protocol。 */
const passthrough = (source: string): RewriteRuleFact =>
  ({ source, destination: source, conditional: false });

const PAGES = [
  "page.tsx",
  "admin/page.tsx",
  "admin/[module]/page.tsx",
  "canvas/page.tsx",
  "canvas/[screen]/page.tsx",
  "chat/(v2)/[threadId]/page.tsx",
  "chat/live/page.tsx",
  "projects/page.tsx",
];

function input(over: Partial<ShadowInput> = {}): ShadowInput {
  return {
    pageFiles: PAGES,
    rewrites: [toApi("/admin/skills/:path*"), toApi("/canvas/templates")],
    allowlist: [],
    ...over,
  };
}

const routes = (i: ShadowInput) => analyzeRewriteShadow(i).findings.map((f) => f.route);

describe("parsePageRoute", () => {
  it("剥掉路由组与并行路由槽，保留动态段", () => {
    expect(parsePageRoute("chat/(v2)/[threadId]/page.tsx")).toBe("/chat/[threadId]");
    expect(parsePageRoute("(entry)/login/page.tsx")).toBe("/login");
    expect(parsePageRoute("dash/@panel/[id]/page.tsx")).toBe("/dash/[id]");
    expect(parsePageRoute("page.tsx")).toBe("/");
  });
});

describe("反方向：rewrite 会不会把前端页面代理走（#610）", () => {
  it("#610 原始现场：`/admin/:path*` 把整片 app/admin/[module] 代理到 API ⇒ 红", () => {
    const report = analyzeRewriteShadow(input({
      rewrites: [toApi("/admin/:path*"), toApi("/canvas/templates")],
    }));
    expect(report.findings.map((f) => f.route)).toEqual(["/admin/[module]"]);
    expect(report.findings[0]).toMatchObject({
      rewrite: "/admin/:path*",
      file: "admin/[module]/page.tsx",
    });
    // 例子必须是一条真会被代理走的具体路径，不是模式——人要一眼看出后果。
    const example = report.findings[0]?.example ?? "";
    expect(example.startsWith("/admin/")).toBe(true);
    expect(example).not.toContain("[");
  });

  it("⚠ 今天没炸纯属单复数巧合：`/admin/skills/:path*` 不吃 `/admin/[module]` ⇒ 绿", () => {
    // 前端是单数 `/admin/skill`、API 是复数 `/admin/skills`。把门写成「交集非空即报警」
    // 会在这里红（`module` 取值 `skills` 时两边确有交集），而 `[module]` 认不出的值
    // 本来就 notFound()——那正是 #610 评论里「必然被放宽到能过为止」的门。
    expect(routes(input())).toEqual([]);
  });

  it("#3492：`/canvas/:path*` 吃掉 app/canvas/[screen] ⇒ 红；补上 PR #3806 的放行 ⇒ 绿", () => {
    const shadowing = [toApi("/canvas/templates"), toApi("/canvas/:path*")];
    expect(routes(input({ rewrites: shadowing }))).toEqual(["/canvas/[screen]"]);

    // 放行规则必须排在通配**之前**：afterFiles 按声明顺序匹配。
    const fixed = [toApi("/canvas/templates"), passthrough("/canvas/template-admin"), toApi("/canvas/:path*")];
    expect(routes(input({ rewrites: fixed }))).toEqual([]);

    // ⚠ 顺序真的被判进去了：同样两条规则、通配排在前面，仍然是红。
    const wrongOrder = [toApi("/canvas/:path*"), passthrough("/canvas/template-admin")];
    expect(routes(input({ rewrites: wrongOrder }))).toEqual(["/canvas/[screen]"]);
  });

  it("#2021 的解法：通配收窄成命名空间枚举后，`/chat/[threadId]` 有逃生路径 ⇒ 绿", () => {
    const namespaced = ["asr-draft", "threads"].flatMap((ns) =>
      [toApi(`/chat/${ns}`), toApi(`/chat/${ns}/:path*`)]);
    expect(routes(input({ rewrites: namespaced }))).toEqual([]);
    // 同一批页面，换成通配就红——证明上一条的绿不是因为门根本没看 `/chat`。
    expect(routes(input({ rewrites: [toApi("/chat/:path*")] }))).toEqual(["/chat/[threadId]"]);
  });

  it("静态页面路由排在 afterFiles 之前，通配再宽也抢不走 ⇒ 不报", () => {
    // `/chat/live`、`/projects`、`/admin`、`/canvas` 都是静态路由。#610 评论里那版
    // 天真实现正是红在这一类「既有重叠」上，12 条里绝大多数是它。
    const report = analyzeRewriteShadow(input({
      pageFiles: ["chat/live/page.tsx", "projects/page.tsx", "admin/page.tsx"],
      rewrites: [toApi("/chat/:path*"), toApi("/projects/:path*"), toApi("/admin/:path*")],
    }));
    expect(report.findings).toEqual([]);
    expect(report.dynamicCount).toBe(0);
  });

  it("多级动态路由：`/projects/:path*` 把 [projectId] 下每一层都吃掉", () => {
    expect(routes(input({
      pageFiles: ["projects/[projectId]/page.tsx", "projects/[projectId]/files/page.tsx"],
      rewrites: [toApi("/projects"), toApi("/projects/:path*")],
    }))).toEqual(["/projects/[projectId]", "/projects/[projectId]/files"]);
  });

  it("catch-all 页面路由同样参与判定", () => {
    expect(routes(input({
      pageFiles: ["docs/[...slug]/page.tsx"],
      rewrites: [toApi("/docs/:path*")],
    }))).toEqual(["/docs/[...slug]"]);
  });

  it("条件规则（has/missing）是不对称的：指向内部不算放行，指向 API 算遮蔽", () => {
    const conditionalPass: RewriteRuleFact =
      { source: "/canvas/template-admin", destination: "/canvas/template-admin", conditional: true };
    // 静态判不出条件成不成立，拿它当「已经放行了」就是给自己发绿灯。
    expect(routes(input({ rewrites: [conditionalPass, toApi("/canvas/:path*")] })))
      .toEqual(["/canvas/[screen]"]);
    const conditionalProxy: RewriteRuleFact =
      { source: "/canvas/:path*", destination: `${API}/canvas/:path*`, conditional: true };
    expect(routes(input({ rewrites: [conditionalProxy] }))).toEqual(["/canvas/[screen]"]);
  });
});

describe("棘轮：只能变短（#610，同 #539 形态）", () => {
  const shadowing = [toApi("/canvas/templates"), toApi("/canvas/:path*")];
  const entry = { route: "/canvas/[screen]", rewrite: "/canvas/:path*", reason: "PR #3806 正在修" };

  it("登记过的遮蔽不报；换一条 rewrite 来遮同一个页面，豁免不跟着走", () => {
    expect(routes(input({ rewrites: shadowing, allowlist: [entry] }))).toEqual([]);
    // 棘轮键是（页面路由，遮蔽它的规则）两件。通配换了写法 ⇒ 当场红，要人重新看一眼。
    expect(routes(input({
      rewrites: [toApi("/canvas/templates"), toApi("/canvas/:rest*")],
      allowlist: [entry],
    }))).toEqual(["/canvas/[screen]"]);
  });

  it("遮蔽修好之后，留在名单里的条目被判陈旧（另一个方向的反证）", () => {
    const fixed = [passthrough("/canvas/template-admin"), toApi("/canvas/:path*")];
    expect(staleShadowAllowlistEntries(input({ rewrites: fixed, allowlist: [entry] })))
      .toEqual([entry]);
    // 还遮着的时候不报陈旧，否则棘轮就成了「登记即红」。
    expect(staleShadowAllowlistEntries(input({ rewrites: shadowing, allowlist: [entry] })))
      .toEqual([]);
  });
});

describe("扫不全就不判（拒绝用残缺输入做否定性判断）", () => {
  it("0 个页面 / 0 条 rewrite ⇒ incomplete，且不报任何遮蔽", () => {
    for (const over of [{ pageFiles: [] }, { rewrites: [] }]) {
      const report = analyzeRewriteShadow(input(over));
      expect(report.incomplete).toBe(true);
      expect(report.incompleteReason).toBeTruthy();
      expect(report.findings).toEqual([]);
    }
  });

  it("看不懂的 source 语法 ⇒ incomplete，而不是「没有遮蔽」", () => {
    // ⚠ 方向很重要：读不懂一条规则时，反向门最危险的不是漏报而是**误报**——
    // 读不出放行规则就会把已经修好的页面重新判成遮蔽，于是门被放宽到能过为止。
    const report = analyzeRewriteShadow(input({
      rewrites: [{ source: "/canvas/:screen(\\d+)", destination: `${API}/canvas/x`, conditional: false }],
    }));
    expect(report.incomplete).toBe(true);
    expect(report.incompleteReason).toContain("看不懂");
  });

  it("incomplete 时棘轮体检也闭嘴（不会把全部条目报成陈旧）", () => {
    expect(staleShadowAllowlistEntries(input({
      rewrites: [],
      allowlist: [{ route: "/canvas/[screen]", rewrite: "/canvas/:path*", reason: "x" }],
    }))).toEqual([]);
  });
});
