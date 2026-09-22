/**
 * lint-nav-reachability 的反证套件。
 *
 * 本仓已九次「全绿但空转」。写完门控立刻造反证是纪律：
 * 这道门控的存在理由是「签核屏全做好了却全部孤立，没有任何门控发现」，
 * 所以它绿的时候必须真的意味着「每个束都走得到、导航里没有旧骨架屏」。
 * 下面逐条把这两种破坏方式合成出来，先确认会红，再确认真仓库是绿的。
 *
 * 用 tmp 目录搭合成 phase / 假 app 树，不碰仓库真文件。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
// @ts-expect-error —— .mjs 无类型声明，故意直接引
import { lintNavReachability, extractNavHrefs, appRouteExists, extractLinkTargets, listAppPageRoutes, routeMatchesTarget, isRedirectStubPage, extractNextConfigRedirectSources } from "./lint-nav-reachability.mjs";

let root: string;
const PHASE = "phase-test";

/** 造一个只含 NAV href 的合成 navigation.ts */
function navTs(hrefs: string[]) {
  const items = hrefs.map((h, i) => `  { key: "k${i}", label: "L", href: "${h}", icon: X, ucRefs: [] },`).join("\n");
  return `export const NAV_SEGMENTS = [\n${items}\n];\n`;
}

/** 在假 app 树里为每个路由建一个 page.tsx（支持 [param] / (group) 目录名直接写在 route 里做映射） */
function makeApp(appDir: string, routeToDir: Record<string, string>) {
  for (const dir of Object.values(routeToDir)) {
    const abs = join(appDir, dir);
    mkdirSync(abs, { recursive: true });
    writeFileSync(join(abs, "page.tsx"), "export default function P(){return null}");
  }
}

function writeJson(p: string, o: unknown) {
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(o));
  return p;
}

// 三个束 + 一个白名单路由的最小可绿世界
const MAP = { [PHASE]: { a: "ui-preview/a", b: "ui-preview/b", c: "ui-preview/c" } };
const OK_CONFIG = {
  [PHASE]: {
    bundleRoutes: { a: "/a", b: "/b", c: "/deep/c" },
    allowRoutes: ["/misc"],
  },
};
const OK_NAV = ["/a", "/b", "/deep/c", "/misc"];
const APP_ROUTES: Record<string, string> = {
  "/a": "a",
  "/b": "b",
  "/deep/c": "deep/c",
  "/misc": "misc",
};

function setup(overrides: {
  nav?: string[];
  config?: unknown;
  map?: unknown;
  appRoutes?: Record<string, string>;
  /** 额外写进假 app 树的文件：相对 appDir 的路径 → 文件内容（判定⑥ 的夹具用） */
  files?: Record<string, string>;
  /** 合成的 next.config.mjs 内容；不给就写一个 redirects() 为空的 */
  nextConfig?: string;
} = {}) {
  const mapFile = writeJson(join(root, "map.json"), overrides.map ?? MAP);
  const configFile = writeJson(join(root, "config.json"), overrides.config ?? OK_CONFIG);
  const navFile = join(root, "navigation.ts");
  writeFileSync(navFile, navTs(overrides.nav ?? OK_NAV));
  const appDir = join(root, "app");
  makeApp(appDir, overrides.appRoutes ?? APP_ROUTES);
  for (const [rel, content] of Object.entries(overrides.files ?? {})) {
    const abs = join(appDir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
  const nextConfigFile = join(root, "next.config.mjs");
  writeFileSync(nextConfigFile, overrides.nextConfig ?? "export default { async redirects() { return []; } };\n");
  return { mapFile, configFile, navFile, appDir, nextConfigFile };
}

function run(o: ReturnType<typeof setup>) {
  return lintNavReachability({ ...o, only: [PHASE] });
}

beforeEach(() => { root = mkdtempSync(join(tmpdir(), "nav-reach-")); });
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("纯函数 —— 抽取与路由解析不能骗人", () => {
  it("extractNavHrefs 只认 href: 键，忽略注释里的裸路径", () => {
    const src = `// 访谈 /studio/interview → /itv 这是注释里的裸路径\n  { href: "/itv" },\n  { href: '/rec' },`;
    expect(extractNavHrefs(src).sort()).toEqual(["/itv", "/rec"]);
  });
  it("appRouteExists 解析静态 / [param] / [...catch] / (group)", () => {
    const appDir = join(root, "app2");
    mkdirSync(join(appDir, "chat"), { recursive: true });
    writeFileSync(join(appDir, "chat/page.tsx"), "x");
    mkdirSync(join(appDir, "projects/[projectId]/files"), { recursive: true });
    writeFileSync(join(appDir, "projects/[projectId]/files/page.tsx"), "x");
    mkdirSync(join(appDir, "(entry)/login"), { recursive: true });
    writeFileSync(join(appDir, "(entry)/login/page.tsx"), "x");
    mkdirSync(join(appDir, "docs/[...slug]"), { recursive: true });
    writeFileSync(join(appDir, "docs/[...slug]/page.tsx"), "x");
    expect(appRouteExists("/chat", appDir)).toBe(true);
    expect(appRouteExists("/projects/demo/files", appDir)).toBe(true);
    expect(appRouteExists("/login", appDir)).toBe(true);          // 穿透 (entry) 路由组
    expect(appRouteExists("/docs/a/b/c", appDir)).toBe(true);     // catch-all
    expect(appRouteExists("/nope", appDir)).toBe(false);
  });
});

describe("反证 —— 逐条破坏必须变红", () => {
  it("基线：三束都可达、导航纯净 ⇒ 绿", () => {
    const { errors, rows } = run(setup());
    expect(errors).toEqual([]);
    expect(rows[0]).toMatchObject({ bundles: 3, reachable: 3 });
  });

  it("① 把束 b 的路由从导航里摘掉 ⇒ 点名束 b 不可达", () => {
    const { errors } = run(setup({ nav: ["/a", "/deep/c", "/misc"] }));
    const joined = errors.join("\n");
    expect(joined).toContain("[不可达]");
    expect(joined).toContain("束「b」");
    expect(joined).toContain("/b");
  });

  it("② 往导航塞一个不属于任何束、不在白名单的路由（旧骨架屏）⇒ 点名它", () => {
    // /studio/interview 是本轮退役的旧骨架屏；给它建个假 page 避免被死链判定抢先
    const { errors } = run(setup({
      nav: [...OK_NAV, "/studio/interview"],
      appRoutes: { ...APP_ROUTES, "/studio/interview": "studio/interview" },
    }));
    const joined = errors.join("\n");
    expect(joined).toContain("[导航指向非法屏]");
    expect(joined).toContain("/studio/interview");
  });

  it("③ material-map 里新增一个束但 config 没配路由 ⇒ 报「配置漏束」点名它", () => {
    const { errors } = run(setup({
      map: { [PHASE]: { ...MAP[PHASE], d: "ui-preview/d" } },
    }));
    const joined = errors.join("\n");
    expect(joined).toContain("[配置漏束]");
    expect(joined).toContain("「d」");
  });

  it("④ 束路由指向 apps/web/app 下不存在的 page ⇒ 报死链，不放行", () => {
    const { errors } = run(setup({
      config: { [PHASE]: { bundleRoutes: { a: "/a", b: "/b", c: "/ghost" }, allowRoutes: ["/misc"] } },
      nav: ["/a", "/b", "/ghost", "/misc"],
      // 不给 /ghost 建 page
    }));
    const joined = errors.join("\n");
    expect(joined).toContain("[死链·束]");
    expect(joined).toContain("/ghost");
  });

  it("⑤ 空集防线：导航一个 href 都没有 ⇒ 失败，不平凡为真", () => {
    const { errors } = run(setup({ nav: [] }));
    expect(errors.join("\n")).toContain("[导航为空]");
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   判定⑥ 「束内页面必须至少被一个真实链接引用」的反证套件（issue #319）

   这条检查的存在理由是 F318（#318）那个具体形状：
   `apps/web/app/tpl/designer/page.tsx` 是蓝本设计器的**真实挂载点**，路由解析得到、
   `nav-reachability.config.json` 里也齐全——所以判定①～⑤ **全部通过**，
   而全仓零 `<Link>`/`router.push` 指向它，导航与「编辑设计」CTA 都还接在
   `/tpl?screen=designer` 这个原型态上。屏做好了、挂对了，用户一路点永远走不到。

   下面第一条测试就是把这个形状原样合成出来：束路由子树下一个真实存在、
   解析得到、配置齐全的 page，仓内零链接引用。**在补这条检查之前它是绿的**
   （旧脚本根本不看页面内部引用），所以这条测试是这次修复的反证。
   ══════════════════════════════════════════════════════════════════════════ */

/** 造一个真实链接到 `to` 的组件文件 */
function linkerTsx(to: string) {
  return `import Link from "next/link";\nexport function Card(){ return <Link href="${to}">go</Link>; }\n`;
}

// 束 a 的子树下多一个页面 /a/designer —— F318 的形状
const SUB_CONFIG = {
  [PHASE]: { bundleRoutes: { a: "/a", b: "/b", c: "/deep/c" }, allowRoutes: ["/misc"] },
};
const SUB_ROUTES = { ...APP_ROUTES, "/a/designer": "a/designer" };

describe("⑥ 束内孤儿页 —— F318 的形状必须会红", () => {
  it("反证（本次修复的那条）：束子树下的 page 解析得到、配置齐全、但全仓零链接 ⇒ 点名它", () => {
    const { errors } = run(setup({ config: SUB_CONFIG, appRoutes: SUB_ROUTES }));
    const joined = errors.join("\n");
    expect(joined).toContain("[束内孤儿页]");
    expect(joined).toContain("/a/designer");
    // ①～⑤ 全绿：这正是 F318 溜过去的原因，孤儿页是**唯一**的红
    expect(errors).toHaveLength(1);
  });

  it("补上一条真实 <Link href> ⇒ 转绿（证明它认的是链接，不是别的什么）", () => {
    const { errors } = run(setup({
      config: SUB_CONFIG,
      appRoutes: SUB_ROUTES,
      files: { "a/blueprint-list.tsx": linkerTsx("/a/designer") },
    }));
    expect(errors).toEqual([]);
  });

  it("只在注释里提到路径**不算**引用 ⇒ 仍然红（F318 的现场就满地是这种注释）", () => {
    const { errors } = run(setup({
      config: SUB_CONFIG,
      appRoutes: SUB_ROUTES,
      files: {
        "a/notes.tsx": `/**\n * 设计器的真实挂载点是 href="/a/designer"，不是 ?screen=designer。\n */\n`
          + `// router.push("/a/designer") —— 这行是注释，不是链接\nexport const X = 1;\n`,
      },
    }));
    expect(errors.join("\n")).toContain("[束内孤儿页]");
  });

  it("router.push / redirect 也算真实链接（不只认 href）", () => {
    for (const call of [`router.push("/a/designer")`, `redirect("/a/designer")`]) {
      const { errors } = run(setup({
        config: SUB_CONFIG,
        appRoutes: SUB_ROUTES,
        files: { "a/go.tsx": `export function Go(){ ${call}; return null; }\n` },
      }));
      expect(errors, call).toEqual([]);
    }
  });

  it("页面**自己**引用自己不算入口 ⇒ 仍然红（孤儿就是没有入边）", () => {
    const { errors } = run(setup({
      config: SUB_CONFIG,
      appRoutes: APP_ROUTES,
      files: { "a/designer/page.tsx": `export default function P(){ return <a href="/a/designer">self</a>; }\n` },
    }));
    expect(errors.join("\n")).toContain("[束内孤儿页]");
  });

  it("束入口本身、导航里的路由、allowRoutes 不进判定（①～③ 已经管了）", () => {
    // /misc 在 allowRoutes、/a /b /deep/c 是束入口：都没有入边也不该报孤儿
    const { errors } = run(setup());
    expect(errors).toEqual([]);
  });

  it("束子树**之外**的零引用页面不管（范围收在束内，不整片扫叶子页）", () => {
    const { errors } = run(setup({
      appRoutes: { ...APP_ROUTES, "/unrelated/leaf": "unrelated/leaf" },
    }));
    expect(errors).toEqual([]);
  });
});

describe("⑥ 三种「不算孤儿」的判定必须真的放行", () => {
  it("机械豁免 a：重定向桩（只有 redirect()、不渲染 JSX）⇒ 绿", () => {
    const { errors } = run(setup({
      config: SUB_CONFIG,
      appRoutes: APP_ROUTES,
      files: {
        "a/designer/page.tsx":
          `import { redirect } from "next/navigation";\nexport default function P(){ redirect("/a"); }\n`,
      },
    }));
    expect(errors).toEqual([]);
  });

  it("机械豁免 b：next.config 的 redirects() 已把它声明成 source ⇒ 绿（含 :param 段）", () => {
    const { errors } = run(setup({
      config: SUB_CONFIG,
      appRoutes: { ...APP_ROUTES, "/a/old/[id]": "a/old/[id]" },
      nextConfig: `export default { async redirects(){ return [\n`
        + `  { source: "/a/designer", destination: "/a", permanent: false },\n`
        + `  { source: "/a/old/:id", destination: "/a", permanent: false },\n`
        + `]; } };\n`,
      files: { "a/designer/page.tsx": "export default function P(){ return null; }" },
    }));
    expect(errors).toEqual([]);
  });

  it("显式豁免：linkExemptRoutes 带理由登记 ⇒ 绿", () => {
    const { errors } = run(setup({
      config: {
        [PHASE]: {
          ...SUB_CONFIG[PHASE],
          linkExemptRoutes: { "/a/designer": "故意只能敲 URL 进的灰度预览路由" },
        },
      },
      appRoutes: SUB_ROUTES,
    }));
    expect(errors).toEqual([]);
  });

  it("豁免理由为空 ⇒ 红（空理由的豁免就是静默漏检）", () => {
    const { errors } = run(setup({
      config: { [PHASE]: { ...SUB_CONFIG[PHASE], linkExemptRoutes: { "/a/designer": "   " } } },
      appRoutes: SUB_ROUTES,
    }));
    expect(errors.join("\n")).toContain("[豁免无理由]");
  });

  it("棘轮：登记的豁免已经被链接上了 ⇒ 报「豁免已过期」，清单只许变短", () => {
    const { errors } = run(setup({
      config: {
        [PHASE]: { ...SUB_CONFIG[PHASE], linkExemptRoutes: { "/a/designer": "理由还在，但入口已经补上了" } },
      },
      appRoutes: SUB_ROUTES,
      files: { "a/blueprint-list.tsx": linkerTsx("/a/designer") },
    }));
    expect(errors.join("\n")).toContain("[豁免已过期]");
  });
});

describe("⑥ 防误报 —— 这些形状**不许**变红", () => {
  it("动态段：/a/[id] 被模板字面量 `/a/${x}` 引用 ⇒ 认命中", () => {
    const { errors } = run(setup({
      config: SUB_CONFIG,
      appRoutes: { ...APP_ROUTES, "/a/[id]": "a/[id]" },
      files: { "a/list.tsx": "export function L(){ return <a href={`/a/${row.id}`}>go</a>; }\n" },
    }));
    expect(errors).toEqual([]);
  });

  it("带 query / hash 的链接 ⇒ 认命中（路径才是路由）", () => {
    const { errors } = run(setup({
      config: SUB_CONFIG,
      appRoutes: SUB_ROUTES,
      files: { "a/cta.tsx": linkerTsx("/a/designer?blueprintId=b1#top") },
    }));
    expect(errors).toEqual([]);
  });

  it("catch-all：/a/[...slug] 被任意深度链接命中", () => {
    const { errors } = run(setup({
      config: SUB_CONFIG,
      appRoutes: { ...APP_ROUTES, "/a/[...slug]": "a/[...slug]" },
      files: { "a/deep.tsx": linkerTsx("/a/x/y/z") },
    }));
    expect(errors).toEqual([]);
  });
});

describe("⑥ 的纯函数 —— 抽链接/去注释不能骗人", () => {
  it("去注释不被行注释里的 `/admin/*` 骗成块注释起点（实现时踩到的真 bug）", () => {
    // 这是实现这条检查时踩到的真 bug：全文 /\*[\s\S]*?\*\// 会从注释里的
    // `/platform-admin/*` 一路吞到下一个 `*/`，把 lib/mock/admin.ts 里真的
    // `href: "/tpl/list"` 整行吃掉，于是 /tpl/list 被误判成孤儿页。
    const src = [
      `// 路由随之迁到 /platform-admin/*（旧 /admin/* 重定向）`,
      `// 见 app/tpl/list/page.tsx。`,
      `export const NAV = [{ key: "blueprint", href: "/tpl/list" }];`,
    ].join("\n");
    expect(extractLinkTargets(src)).toEqual(["/tpl/list"]);
  });

  it("extractLinkTargets 认 href/router.push/redirect，不认块注释里的同款写法", () => {
    const src = [
      `/**`,
      ` * 旧入口 href="/ghost" 已退役。`,
      ` */`,
      `export function C(){ router.push("/x"); redirect("/y"); return <a href={"/z"}>g</a>; }`,
    ].join("\n");
    expect(extractLinkTargets(src).sort()).toEqual(["/x", "/y", "/z"]);
    expect(extractLinkTargets(src)).not.toContain("/ghost");
  });

  it("listAppPageRoutes 算路由：(group) 透明、[param] 原样保留", () => {
    const appDir = join(root, "app3");
    for (const d of ["chat/(v2)/[threadId]", "(entry)/login", "tpl/designer"]) {
      mkdirSync(join(appDir, d), { recursive: true });
      writeFileSync(join(appDir, d, "page.tsx"), "x");
    }
    mkdirSync(appDir, { recursive: true });
    writeFileSync(join(appDir, "page.tsx"), "x");
    expect(listAppPageRoutes(appDir).map((p: { route: string }) => p.route))
      .toEqual(["/", "/chat/[threadId]", "/login", "/tpl/designer"]);
  });

  it("routeMatchesTarget 双向宽松：路由侧动态段 / 目标侧 ${} 都当通配", () => {
    expect(routeMatchesTarget("/a/[id]", "/a/demo")).toBe(true);
    expect(routeMatchesTarget("/a/demo", "/a/${id}")).toBe(true);
    expect(routeMatchesTarget("/a/[...s]", "/a/x/y")).toBe(true);
    expect(routeMatchesTarget("/a/designer", "/a/list")).toBe(false);
    expect(routeMatchesTarget("/a/designer", "/a")).toBe(false);
    expect(routeMatchesTarget("/a/designer", "https://x.test/a/designer")).toBe(false);
  });

  it("isRedirectStubPage：只有 redirect() 的算桩，渲染 JSX 的不算", () => {
    expect(isRedirectStubPage(
      `import { redirect } from "next/navigation";\nexport default function P(){ redirect("/itv"); }\n`,
    )).toBe(true);
    expect(isRedirectStubPage(
      `export default function P(){ return <div>real screen</div>; }\n`,
    )).toBe(false);
  });

  it("extractNextConfigRedirectSources 只抽 redirects()，不抽 rewrites()", () => {
    const src = `export default {\n`
      + `  async redirects(){ return [{ source: "/chat/copilotkit-v2/:threadId", destination: "/chat/:threadId" }]; },\n`
      + `  async rewrites(){ return [{ source: "/api/x", destination: "http://api/x" }]; },\n`
      + `};\n`;
    expect(extractNextConfigRedirectSources(src)).toEqual(["/chat/copilotkit-v2/[threadId]"]);
  });
});

describe("反向反证 —— 真仓库当前必须是绿的", () => {
  it("phase-01：十一束全部可达，导航无非法屏、无死链", () => {
    const { errors, rows } = lintNavReachability({ only: ["phase-01-run-a-project"] });
    expect(errors).toEqual([]);
    expect(rows[0].reachable).toBe(rows[0].bundles);
    expect(rows[0].bundles).toBeGreaterThanOrEqual(11);
  });

  it("phase-01：束内也没有零引用的孤儿页（⑥ 在真仓库上是绿的，且真的扫到了子页）", () => {
    const { errors, rows } = lintNavReachability({ only: ["phase-01-run-a-project"] });
    expect(errors.filter((e: string) => e.includes("[束内孤儿页]"))).toEqual([]);
    // 空集会让⑥平凡为真——断言它确实有东西可判（同⑤的空集防线）
    expect(rows[0].subPages).toBeGreaterThan(0);
  });
});
