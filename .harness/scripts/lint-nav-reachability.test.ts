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
import { lintNavReachability, extractNavHrefs, appRouteExists } from "./lint-nav-reachability.mjs";

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
} = {}) {
  const mapFile = writeJson(join(root, "map.json"), overrides.map ?? MAP);
  const configFile = writeJson(join(root, "config.json"), overrides.config ?? OK_CONFIG);
  const navFile = join(root, "navigation.ts");
  writeFileSync(navFile, navTs(overrides.nav ?? OK_NAV));
  const appDir = join(root, "app");
  makeApp(appDir, overrides.appRoutes ?? APP_ROUTES);
  return { mapFile, configFile, navFile, appDir };
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

describe("反向反证 —— 真仓库当前必须是绿的", () => {
  it("phase-01：十一束全部可达，导航无非法屏、无死链", () => {
    const { errors, rows } = lintNavReachability({ only: ["phase-01-run-a-project"] });
    expect(errors).toEqual([]);
    expect(rows[0].reachable).toBe(rows[0].bundles);
    expect(rows[0].bundles).toBeGreaterThanOrEqual(11);
  });
});
