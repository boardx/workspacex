/**
 * lint-no-backend-badge 的反证套件（#621）。
 *
 * 本仓已九次「全绿但空转」。写完门控立刻造反证是纪律：这道门控的存在理由是
 * 「零后端模块（MCP 等）用了和真实模块一样的示例配置提示，把没做的说成了刻意设计」，
 * 所以它绿的时候必须真的意味着「每个纯 mock 屏都渲染了 NoBackendNotice」。
 * 下面先合成一个故意不标注的零后端屏，确认门控会红且只点名那一个；
 * 再确认加标注后转绿；再确认真实后端屏不被误判；最后核对真仓库当前是绿的。
 *
 * 用 tmp 目录搭合成的路由文件 + 组件目录，不碰仓库真文件。
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
// @ts-expect-error —— .mjs 无类型声明，故意直接引
import { lintNoBackendBadge, extractScreenImports, classifyScreenFile } from "../scripts/lint-no-backend-badge.mjs";

let root: string;

function modulePageTs(names: string[]) {
  const imports = names.map((n) => `import { ${n} } from "@/components/admin/${kebab(n)}";`).join("\n");
  const entries = names.map((n) => `  ${kebab(n).replace(/-screen$/, "")}: ${n},`).join("\n");
  return `${imports}\nconst SCREENS = {\n${entries}\n};\nexport default function P() { return null; }\n`;
}

/** FooBarScreen -> foo-bar-screen（够用即可，不追求通用 kebab-case 实现） */
function kebab(name: string) {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

function writeScreen(componentsDir: string, relPath: string, source: string) {
  mkdirSync(componentsDir, { recursive: true });
  writeFileSync(join(componentsDir, `${relPath}.tsx`), source);
}

function setup() {
  const overviewPage = join(root, "app", "admin", "page.tsx");
  const modulePage = join(root, "app", "admin", "[module]", "page.tsx");
  mkdirSync(join(root, "app", "admin", "[module]"), { recursive: true });
  const componentsDir = join(root, "components", "admin");
  mkdirSync(componentsDir, { recursive: true });
  return { overviewPage, modulePage, componentsDir };
}

beforeEach(() => { root = mkdtempSync(join(tmpdir(), "no-backend-badge-")); });
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("纯函数 —— 抽取与分类不能骗人", () => {
  it("extractScreenImports 只认 @/components/admin/ 前缀且以 Screen 结尾的 import", () => {
    const src = [
      `import { FooScreen } from "@/components/admin/foo-screen";`,
      `import { Bar } from "@/components/admin/bar-panel";`, // 不以 Screen 结尾，不算
      `import { Baz } from "some-other-place";`, // 前缀不对，不算
    ].join("\n");
    const found = extractScreenImports(src);
    expect(found).toEqual([{ name: "FooScreen", relPath: "foo-screen" }]);
  });

  it("classifyScreenFile：纯 mock 且未渲染标识 ⇒ usesMock=true, rendersNotice=false", () => {
    const dir = mkdtempSync(join(tmpdir(), "cls-"));
    const file = join(dir, "x.tsx");
    writeFileSync(file, `import { X } from "@/lib/mock/admin";\nexport function S(){ return <div>{X}</div>; }\n`);
    const c = classifyScreenFile(file);
    expect(c).toMatchObject({ exists: true, usesMock: true, usesRealBackend: false, rendersNotice: false });
    rmSync(dir, { recursive: true, force: true });
  });

  it("classifyScreenFile：有 apiRequest ⇒ usesRealBackend=true", () => {
    const dir = mkdtempSync(join(tmpdir(), "cls-"));
    const file = join(dir, "x.tsx");
    writeFileSync(file, `import { apiRequest } from "@/lib/api-client";\nexport function S(){ apiRequest("/x"); return null; }\n`);
    const c = classifyScreenFile(file);
    expect(c).toMatchObject({ usesMock: false, usesRealBackend: true });
    rmSync(dir, { recursive: true, force: true });
  });

  it("classifyScreenFile：import 了 NoBackendNotice 但 JSX 没用到 ⇒ rendersNotice 仍为 false", () => {
    const dir = mkdtempSync(join(tmpdir(), "cls-"));
    const file = join(dir, "x.tsx");
    writeFileSync(
      file,
      `import { X } from "@/lib/mock/admin";\nimport { NoBackendNotice } from "./no-backend-notice";\nexport function S(){ return <div>{X}</div>; }\n`,
    );
    const c = classifyScreenFile(file);
    expect(c).toMatchObject({ usesMock: true, rendersNotice: false });
    rmSync(dir, { recursive: true, force: true });
  });
});

describe("反证 —— 逐条破坏必须变红，只红对应那一条", () => {
  it("基线：一个真实后端屏 + 一个已标注的零后端屏 ⇒ 绿", () => {
    const { overviewPage, modulePage, componentsDir } = setup();
    writeFileSync(overviewPage, modulePageTs(["RealScreen"]));
    writeFileSync(modulePage, modulePageTs(["FakeScreen"]));
    writeScreen(componentsDir, "real-screen", `import { apiRequest } from "@/lib/api-client";\nexport function RealScreen(){ apiRequest("/x"); return null; }\n`);
    writeScreen(
      componentsDir,
      "fake-screen",
      [
        `import { X } from "@/lib/mock/admin";`,
        `import { NoBackendNotice } from "./no-backend-notice";`,
        `export function FakeScreen(){ return <div>{X}<NoBackendNotice /></div>; }`,
      ].join("\n"),
    );
    const { errors, rows } = lintNoBackendBadge({ overviewPage, modulePage, componentsDir }) as {
      errors: string[];
      rows: Array<{ name: string; zeroBackend: boolean; rendersNotice: boolean }>;
    };
    expect(errors).toEqual([]);
    expect(rows.find((r) => r.name === "FakeScreen")).toMatchObject({ zeroBackend: true, rendersNotice: true });
    expect(rows.find((r) => r.name === "RealScreen")).toMatchObject({ zeroBackend: false });
  });

  it("① 故意让一个零后端屏不加标识 ⇒ 门控报红，只点名它，不牵连真实后端屏", () => {
    const { overviewPage, modulePage, componentsDir } = setup();
    writeFileSync(overviewPage, modulePageTs(["RealScreen"]));
    writeFileSync(modulePage, modulePageTs(["FakeScreen"]));
    writeScreen(componentsDir, "real-screen", `import { apiRequest } from "@/lib/api-client";\nexport function RealScreen(){ apiRequest("/x"); return null; }\n`);
    // ⚠ 反证核心：纯 mock，且**没有**渲染 NoBackendNotice
    writeScreen(componentsDir, "fake-screen", `import { X } from "@/lib/mock/admin";\nexport function FakeScreen(){ return <div>{X}</div>; }\n`);

    const { errors } = lintNoBackendBadge({ overviewPage, modulePage, componentsDir });
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain("[未标注]");
    expect(errors[0]).toContain("FakeScreen");
    expect(errors[0]).not.toContain("RealScreen");
  });

  it("② 只 import NoBackendNotice 但不在 JSX 里用它 ⇒ 仍然报红（防止「导了但没画」的假标注）", () => {
    const { overviewPage, modulePage, componentsDir } = setup();
    writeFileSync(overviewPage, modulePageTs([]));
    writeFileSync(modulePage, modulePageTs(["FakeScreen"]));
    writeScreen(
      componentsDir,
      "fake-screen",
      [
        `import { X } from "@/lib/mock/admin";`,
        `import { NoBackendNotice } from "./no-backend-notice";`, // 导了
        `export function FakeScreen(){ return <div>{X}</div>; }`, // 但没用
      ].join("\n"),
    );
    const { errors } = lintNoBackendBadge({ overviewPage, modulePage, componentsDir });
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain("[未标注]");
    expect(errors[0]).toContain("FakeScreen");
  });

  it("③ 用 lib/live-* 接线的屏，即便同时也 import 了 lib/mock，也不算零后端 ⇒ 不强制标注", () => {
    const { overviewPage, modulePage, componentsDir } = setup();
    writeFileSync(overviewPage, modulePageTs([]));
    writeFileSync(modulePage, modulePageTs(["MixedScreen"]));
    writeScreen(
      componentsDir,
      "mixed-screen",
      [
        `import { X } from "@/lib/mock/admin";`, // 例如常量枚举仍取自 mock
        `import { listThings } from "@/lib/live-things";`, // 但数据走真实接线
        `export function MixedScreen(){ return <div>{X}</div>; }`,
      ].join("\n"),
    );
    const { errors, rows } = lintNoBackendBadge({ overviewPage, modulePage, componentsDir });
    expect(errors).toEqual([]);
    expect(rows[0]).toMatchObject({ zeroBackend: false });
  });

  it("④ 屏 import 的组件文件不存在 ⇒ 报死链，不静默放行", () => {
    const { overviewPage, modulePage, componentsDir } = setup();
    writeFileSync(overviewPage, modulePageTs([]));
    writeFileSync(modulePage, modulePageTs(["GhostScreen"]));
    // 不建 ghost-screen.tsx
    const { errors } = lintNoBackendBadge({ overviewPage, modulePage, componentsDir });
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain("[死链]");
    expect(errors[0]).toContain("GhostScreen");
  });

  it("⑤ 空集防线：两个路由文件都抽不出任何 Screen ⇒ 失败，不平凡为真", () => {
    const { overviewPage, modulePage, componentsDir } = setup();
    writeFileSync(overviewPage, `export default function P(){ return null; }\n`);
    writeFileSync(modulePage, `export default function P(){ return null; }\n`);
    const { errors } = lintNoBackendBadge({ overviewPage, modulePage, componentsDir });
    expect(errors.join("\n")).toContain("[无屏]");
  });
});

describe("反向反证 —— 真仓库当前必须是绿的", () => {
  it("apps/web/app/admin/** 下每个零后端模块屏都渲染了 NoBackendNotice", () => {
    const { errors, rows } = lintNoBackendBadge();
    expect(errors, errors.join("\n")).toEqual([]);
    /**
     * issue #1849：MCP 后台页接上了第一条真实链路（`discoverRemoteMcpTools`，见
     * `mcp-screen.tsx` 的 `lint-no-backend-badge:backed-by-children` 标记），是这两个
     * 路由文件目前能枚举到的七块屏里**最后一块**零后端的。⇒ `zeroBackendRows.length`
     * 合法地变成了 0——这不是枚举链路断了，是产品状态真的变了。
     *
     * ⚠ 原来这里断言 `zeroBackendRows.length > 0`，用意是"防止枚举链路悄悄空转"（见
     *   本文件顶部头注）。但把这条防空转检查焊死在"某块真实生产屏必须永远保持纯 mock"
     *   上，本身就是一个会随功能开发必然过期的不变量——上面 185 行之前的合成 fixture
     *   已经用受控输入把红/绿转换测得很干净，不需要再靠一块真实屏"恰好还没接后端"
     *   来证明枚举没坏。防空转改成断言"枚举到的屏总数 > 0"：这条不会因为某块屏
     *   接了真后端而被迫改，只会在 `extractScreenImports` 真的抓不到任何屏时才红。
     */
    expect(rows.length).toBeGreaterThan(0);
  });
});
