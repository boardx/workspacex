import { describe, expect, it } from "vitest";
import {
  analyzeVitestConfigReachability,
  includedSpecs,
} from "./lib/vitest-config-reachability.ts";

/**
 * 喂 fixture 的纯函数单测（issue #3164）。
 *
 * 第二条与第三条是这条门控的全部价值所在：**evidence 文本不是入口**，
 * 而**传递可达是真可达**。前者判错会让 #3164 那 7 个"只被 evidence txt 引用"的 config
 * 假绿，后者判错会把 `vitest.native-document.config.ts` 这种确实跑得到的 config 误报成孤儿。
 */
const config = (name: string, content = "") => ({ name, content });

describe("vitest config 自动化入口门控", () => {
  it("零引用的 config 判孤儿", () => {
    const report = analyzeVitestConfigReachability({
      configs: [config("vitest.canvas-skill-real-model.config.ts")],
      entries: [{ name: "package.json#scripts", content: "vitest run" }],
    });
    expect(report.orphans).toEqual(["vitest.canvas-skill-real-model.config.ts"]);
    expect(report.reachable).toHaveLength(0);
  });

  it("只被 evidence 文本引用的 config 仍判孤儿——静态痕迹不是入口", () => {
    // 调用方不会把 evidence txt 放进 entries；这里钉的是"没人把它算进来时结论必须是红"。
    const report = analyzeVitestConfigReachability({
      configs: [config("vitest.methods-real-model.config.ts")],
      entries: [{ name: ".github/workflows/backend-gates.yml", content: "pnpm --filter @repo/api test" }],
    });
    expect(report.orphans).toEqual(["vitest.methods-real-model.config.ts"]);
  });

  it("npm script 与 workflow 都算入口，并记下是谁引用的", () => {
    const report = analyzeVitestConfigReachability({
      configs: [config("vitest.storage.config.ts"), config("vitest.asr-real-model.config.ts")],
      entries: [
        { name: "apps/api/package.json#scripts", content: "vitest run --config vitest.storage.config.ts" },
        { name: ".github/workflows/s016-asr-real-evidence.yml", content: "vitest run --config vitest.asr-real-model.config.ts" },
      ],
    });
    expect(report.orphans).toEqual([]);
    expect(report.reachable).toEqual([
      { config: "vitest.storage.config.ts", via: "apps/api/package.json#scripts" },
      { config: "vitest.asr-real-model.config.ts", via: ".github/workflows/s016-asr-real-evidence.yml" },
    ]);
  });

  it("可达 config 引用到的 config 也可达（native-document ← native-runtime-lane ← workflow）", () => {
    const report = analyzeVitestConfigReachability({
      configs: [
        config("vitest.native-document.config.ts"),
        config("vitest.native-runtime-lane.config.ts", "import './vitest.native-document.config.ts';"),
      ],
      entries: [{ name: "wf.yml", content: "vitest run --config vitest.native-runtime-lane.config.ts" }],
    });
    expect(report.orphans).toEqual([]);
    expect(report.reachable.map((entry) => entry.via)).toEqual([
      "wf.yml",
      "vitest.native-runtime-lane.config.ts",
    ]);
  });

  it("孤儿 config 之间互相引用不能让谁变可达——两个都跑不到", () => {
    const report = analyzeVitestConfigReachability({
      configs: [
        config("vitest.a.config.ts", "vitest.b.config.ts"),
        config("vitest.b.config.ts", "vitest.a.config.ts"),
      ],
      entries: [{ name: "package.json#scripts", content: "echo nothing" }],
    });
    expect(report.orphans).toEqual(["vitest.a.config.ts", "vitest.b.config.ts"]);
  });

  it("默认 config（roots）算天然可达，它引用到的车道跟着可达", () => {
    const report = analyzeVitestConfigReachability({
      configs: [config("vitest.exclusive.config.ts")],
      entries: [],
      roots: [config("vitest.config.ts", "// 由 vitest.exclusive.config.ts 独占补跑")],
    });
    expect(report.orphans).toEqual([]);
    expect(report.reachable[0]?.via).toBe("vitest.config.ts");
  });

  it("名字互为前缀的 config 不互相顶替（skill- 与 skills-）", () => {
    const report = analyzeVitestConfigReachability({
      configs: [
        config("vitest.document-skill-real-model.config.ts"),
        config("vitest.document-skills-real-model.config.ts"),
      ],
      entries: [{ name: "wf.yml", content: "vitest run --config vitest.document-skills-real-model.config.ts" }],
    });
    expect(report.orphans).toEqual(["vitest.document-skill-real-model.config.ts"]);
  });

  it("live spec 没有被任何可达 config 的 include 收走时判红", () => {
    const orphaned = analyzeVitestConfigReachability({
      configs: [
        config("vitest.visual-skills-real-model.config.ts", "include:['tests/agent-runtime/visual-skills-real-model.live.ts']"),
      ],
      entries: [],
      specs: ["tests/agent-runtime/visual-skills-real-model.live.ts"],
    });
    // config 本身是孤儿，它的 include 就不算数——spec 同样没有入口。
    expect(orphaned.uncoveredSpecs).toEqual(["tests/agent-runtime/visual-skills-real-model.live.ts"]);

    const covered = analyzeVitestConfigReachability({
      ...{
        configs: [
          config("vitest.visual-skills-real-model.config.ts", "include:['tests/agent-runtime/visual-skills-real-model.live.ts']"),
        ],
        specs: ["tests/agent-runtime/visual-skills-real-model.live.ts"],
      },
      entries: [{ name: "pkg#scripts", content: "vitest run --config vitest.visual-skills-real-model.config.ts" }],
    });
    expect(covered.uncoveredSpecs).toEqual([]);
  });

  it("include 里的 glob 按 glob 判覆盖", () => {
    const report = analyzeVitestConfigReachability({
      configs: [config("vitest.workbench-unit.config.ts", 'include: ["tests/agent-runtime/workbench-*.test.ts"]')],
      entries: [{ name: "pkg#scripts", content: "vitest run --config vitest.workbench-unit.config.ts" }],
      specs: ["tests/agent-runtime/workbench-agui-order.test.ts", "tests/agent-runtime/other.live.ts"],
    });
    expect(report.uncoveredSpecs).toEqual(["tests/agent-runtime/other.live.ts"]);
  });

  it("includedSpecs 归一化 ./ 与 apps/api/ 前缀，并忽略非 tests/ 的字面量", () => {
    expect(
      includedSpecs(
        `import base from './vitest.config';\ninclude: ["apps/api/tests/a.test.ts", "./tests/b.live.ts", "src/c.ts"]`,
      ),
    ).toEqual(["tests/a.test.ts", "tests/b.live.ts"]);
  });
});
