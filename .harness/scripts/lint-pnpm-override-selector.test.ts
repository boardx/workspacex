/**
 * `pnpm.overrides` 的 `parent>child` 选择器门控的反证套件（issue #2614）。
 *
 * 本仓的规矩：每条断言先造一种**真实发生过**的破坏方式，确认它会红，
 * 才有资格相信它绿的时候说明了什么。
 *
 * - 第一组钉死 #2613 的原形（peer 边被 `parent>child` 钉，静默解析成 `1.1.5`）。
 * - 第二组是**反向反证**：平铺 override 与 `foo@>=1.0.0` 这类**版本范围里带 `>`** 的键
 *   必须放行——门控第一版若写成 `key.includes(">")`，这两种全是误报，
 *   一道会误伤正常写法的门最后一定被人关掉。
 * - 最后一组打真仓库：仓库现状必须零命中。它是本 issue 的**反证锚点**——
 *   在移除根 `package.json` 那条冗余 override 之前，这条是红的。
 */
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  analyzePackageJsonFiles,
  findNestingSeparator,
  overrideEntriesFromWorkspaceManifest,
  analyzeOverrideEntries,
} from "./lib/pnpm-override-selector.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const pkg = (overrides: Record<string, string>, file = "package.json") => ({
  file,
  source: JSON.stringify({ name: "x", pnpm: { overrides } }),
});

describe("parent>child 选择器判违规", () => {
  it("钉死 #2613 的原形：peer 边被 parent>child 钉住", () => {
    const report = analyzePackageJsonFiles([
      pkg({ "@langchain/langgraph-checkpoint-postgres>@langchain/langgraph-checkpoint": "0.1.1" }),
    ]);
    expect(report.nested).toHaveLength(1);
    expect(report.nested[0]).toMatchObject({
      file: "package.json",
      field: "pnpm.overrides",
      parent: "@langchain/langgraph-checkpoint-postgres",
      child: "@langchain/langgraph-checkpoint",
      value: "0.1.1",
    });
  });

  it("父包带版本范围的嵌套写法同样判违规", () => {
    expect(analyzePackageJsonFiles([pkg({ "foo@1.2.3>bar": "2.0.0" })]).nested).toHaveLength(1);
    expect(analyzePackageJsonFiles([pkg({ "foo>bar@^2": "2.0.0" })]).nested).toHaveLength(1);
  });

  it("yarn 语法的 resolutions 也在射程内——只堵一半门等于没堵", () => {
    const report = analyzePackageJsonFiles([
      { file: "apps/api/package.json", source: JSON.stringify({ resolutions: { "a>b": "1.0.0" } }) },
    ]);
    expect(report.nested).toHaveLength(1);
    expect(report.nested[0]).toMatchObject({ field: "resolutions", file: "apps/api/package.json" });
  });

  it("pnpm-workspace.yaml 里的 overrides 也在射程内（pnpm 10 起的新位置）", () => {
    const entries = overrideEntriesFromWorkspaceManifest("pnpm-workspace.yaml", {
      packages: ["apps/*"],
      overrides: { "a>b": "1.0.0", c: "2.0.0" },
    });
    const report = analyzeOverrideEntries(entries, { filesScanned: 1 });
    expect(report.entriesScanned).toBe(2);
    expect(report.nested.map((n) => n.key)).toEqual(["a>b"]);
  });

  it("逐条点名，多处违规不会只报第一处", () => {
    const report = analyzePackageJsonFiles([
      pkg({ "a>b": "1", "c>d": "2" }),
      pkg({ "e>f": "3" }, "apps/api/package.json"),
    ]);
    expect(report.nested.map((n) => `${n.file}:${n.key}`)).toEqual([
      "package.json:a>b",
      "package.json:c>d",
      "apps/api/package.json:e>f",
    ]);
  });
});

describe("反向反证：不许误伤正常写法", () => {
  it("平铺 override（含带版本范围的）放行——本门控拦的是选择器语法，不是 override 本身", () => {
    const report = analyzePackageJsonFiles([
      pkg({ foo: "1.0.0", "bar@^1": "1.9.9", "@scope/baz": "2.0.0" }),
    ]);
    expect(report.nested).toHaveLength(0);
    expect(report.entriesScanned).toBe(3);
  });

  it("版本范围里的 `>` 不是父子分隔符——裸 includes(\">\") 会把这些全误报", () => {
    for (const key of ["foo@>=1.0.0", "foo@>1.2.3", "@scope/foo@>=2 <3", "foo@<=1.0.0"]) {
      expect(findNestingSeparator(key), key).toBe(-1);
      expect(analyzePackageJsonFiles([pkg({ [key]: "1.0.0" })]).nested, key).toHaveLength(0);
    }
  });

  it("没有 pnpm.overrides 的清单不影响判定", () => {
    const report = analyzePackageJsonFiles([
      { file: "apps/web/package.json", source: JSON.stringify({ name: "web", dependencies: { next: "15" } }) },
    ]);
    expect(report).toMatchObject({ filesScanned: 1, entriesScanned: 0, nested: [], unreadable: [] });
  });
});

describe("fail-closed：扫不动不算通过", () => {
  it("解析不了的清单进 unreadable，而不是被静默跳过", () => {
    const report = analyzePackageJsonFiles([{ file: "broken/package.json", source: "{ not json" }]);
    expect(report.unreadable).toHaveLength(1);
    expect(report.unreadable[0]!.file).toBe("broken/package.json");
  });
});

describe("真仓库现状", () => {
  /**
   * 本 issue 的反证锚点：这条在**移除根 package.json 那条冗余 override 之前是红的**
   * （它就是 #2613 踩过的那条 `@langchain/langgraph-checkpoint-postgres>@langchain/langgraph-checkpoint`）。
   * 走真入口而不是在这里复制一遍目录遍历——复制一份遍历逻辑，门和测试就会各自漂移。
   */
  it("`pnpm run lint:pnpm-override-selector` 在真仓库上退 0", () => {
    const out = execFileSync("pnpm", ["exec", "tsx", ".harness/scripts/lint-pnpm-override-selector.mjs"], {
      cwd: ROOT,
      encoding: "utf8",
    });
    expect(out).toMatch(/✓ \[pnpm-override-selector\]/);
  });
});
