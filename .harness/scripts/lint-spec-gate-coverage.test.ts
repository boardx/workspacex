/**
 * #512 / #523 门控的反证套件。
 *
 * 三层，缺一不可：
 *  · **纯判定层**（`classifySpecs`）：对构造输入断言每一种判决。其中几种在真实仓库
 *    （希望）永远不出现——`covered-but-exempt` 与两种陈旧豁免——而永远不出现的分支正是
 *    最容易写错又永远测不到的那种。
 *  · **端到端反证层**（`describe("反证")`）：在临时仓库骨架上做对照实验，
 *    **只改一处**（加不加 `paths:`），断言判决翻面。#523 的判据本身在这一层受检。
 *  · **真实仓库层**：锁住本次修复的事实，以及「门控本身没在空转」。
 *
 * ⚠ 反证的第一版红在了它想测的那一步**之前**（详见 `describe("反证")` 里的注释），
 *   本套件保留了把接缝隔离开的那个版本。红了不等于测到了。
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import {
  allSpecFiles,
  auditSpecGateCoverage,
  classifySpecs,
  CONDITIONAL_COVERAGE_EXEMPTIONS,
  EXEMPTIONS,
  resolveInvokedConfigs,
} from "./lint-spec-gate-coverage.mjs";

const GATE = fileURLToPath(new URL("./lint-spec-gate-coverage.mjs", import.meta.url));

/**
 * `.mjs` 没有 .d.ts，这里把用到的形状显式写一遍（与 `classifySpecs` /
 * `resolveInvokedConfigs` 的返回一一对应）。
 */
type Coverage = { configPath: string; unconditional: boolean };
type InvokedConfig = Coverage & { pkgDir: string; via: string[] };
type Exemption = { spec: string; reason?: string };
type Row = {
  spec: string;
  by: string[];
  unconditionalBy: string[];
  conditionalBy: string[];
  verdict: string;
  reason?: string;
};

/** 覆盖关系的最小构造器：`unconditional` 是 #523 之后判定的第二个维度。 */
const covers = (configPath: string, unconditional = true): Coverage => ({ configPath, unconditional });

const invokedConfigs = (root?: string): InvokedConfig[] => resolveInvokedConfigs(root);

describe("判定逻辑（纯函数）", () => {
  it("被某个无条件 config 跑到 ⇒ covered", () => {
    const { rows } = classifySpecs({
      population: ["a.spec.ts"],
      coveredBy: new Map([["a.spec.ts", [covers("x.config.ts")]]]),
      exemptions: [],
    });
    expect(rows[0]).toMatchObject({ verdict: "covered", by: ["x.config.ts"] });
  });

  it("没有任何 config 跑到、也没豁免 ⇒ unrun（这是 #512 的病）", () => {
    const { rows } = classifySpecs({
      population: ["a.spec.ts"],
      coveredBy: new Map([["a.spec.ts", []]]),
      exemptions: [],
    });
    expect(rows[0].verdict).toBe("unrun");
  });

  it("没被跑到但有署名豁免 ⇒ exempt，且理由必须随判决一起带出来", () => {
    const { rows } = classifySpecs({
      population: ["a.spec.ts"],
      coveredBy: new Map([["a.spec.ts", []]]),
      exemptions: [{ spec: "a.spec.ts", reason: "有名有姓的理由" }],
    });
    expect(rows[0]).toMatchObject({ verdict: "exempt", reason: "有名有姓的理由" });
  });

  it("已被跑到却仍留着豁免 ⇒ covered-but-exempt（陈旧豁免要红，否则清单会烂掉）", () => {
    const { rows } = classifySpecs({
      population: ["a.spec.ts"],
      coveredBy: new Map([["a.spec.ts", [covers("x.config.ts")]]]),
      exemptions: [{ spec: "a.spec.ts", reason: "早就不需要了" }],
    });
    expect(rows[0].verdict).toBe("covered-but-exempt");
  });

  it("豁免指向不存在的文件 ⇒ 报为 stale（改名/删除后忘了同步）", () => {
    const { staleExemptions } = classifySpecs({
      population: ["a.spec.ts"],
      coveredBy: new Map([["a.spec.ts", [covers("x.config.ts")]]]),
      exemptions: [{ spec: "gone.spec.ts", reason: "文件早没了" }],
    });
    expect(staleExemptions).toEqual(["gone.spec.ts"]);
  });
});

describe("条件覆盖的判定（#523）", () => {
  /**
   * 对照组与实验组的**唯一**差别是 `unconditional`：同一条 spec、同一份 config、
   * 同一份豁免清单。它红的时候只可能红在「覆盖是有条件的」这一条上。
   */
  it("只有条件 job 跑到、没有署名 ⇒ conditionally-covered（旧定义会判 covered，这就是 #523 的假绿）", () => {
    const unconditional = classifySpecs({
      population: ["a.spec.ts"],
      coveredBy: new Map([["a.spec.ts", [covers("x.config.ts", true)]]]),
      exemptions: [],
      conditionalExemptions: [],
    });
    expect(unconditional.rows[0].verdict).toBe("covered");

    const conditional = classifySpecs({
      population: ["a.spec.ts"],
      coveredBy: new Map([["a.spec.ts", [covers("x.config.ts", false)]]]),
      exemptions: [],
      conditionalExemptions: [],
    });
    expect(conditional.rows[0]).toMatchObject({
      verdict: "conditionally-covered",
      conditionalBy: ["x.config.ts"],
      unconditionalBy: [],
    });
  });

  it("条件覆盖 + 署名豁免 ⇒ conditional-exempt，理由随判决带出来", () => {
    const { rows } = classifySpecs({
      population: ["a.spec.ts"],
      coveredBy: new Map([["a.spec.ts", [covers("x.config.ts", false)]]]),
      exemptions: [],
      conditionalExemptions: [{ spec: "a.spec.ts", reason: "有名有姓的理由" }],
    });
    expect(rows[0]).toMatchObject({ verdict: "conditional-exempt", reason: "有名有姓的理由" });
  });

  it("一条无条件 + 一条条件 ⇒ 仍是 covered（有一个人每次都来就够了）", () => {
    const { rows } = classifySpecs({
      population: ["a.spec.ts"],
      coveredBy: new Map([["a.spec.ts", [covers("cond.config.ts", false), covers("always.config.ts", true)]]]),
      exemptions: [],
    });
    expect(rows[0]).toMatchObject({ verdict: "covered", unconditionalBy: ["always.config.ts"] });
  });

  it("条件豁免的 spec 后来被无条件 job 接住了 ⇒ 陈旧，要红", () => {
    const { rows, staleConditionalExemptions } = classifySpecs({
      population: ["a.spec.ts"],
      coveredBy: new Map([["a.spec.ts", [covers("x.config.ts", true)]]]),
      exemptions: [],
      conditionalExemptions: [{ spec: "a.spec.ts", reason: "当时只有条件覆盖" }],
    });
    expect(rows[0].verdict).toBe("covered-but-exempt");
    expect(staleConditionalExemptions).toEqual([
      { spec: "a.spec.ts", why: expect.stringContaining("无条件") },
    ]);
  });

  /**
   * 最要紧的一种烂法：条件豁免写的理由是「有人跑，只是有条件」。那个 job 被删掉之后
   * 前提就不成立了，而判决会安静地落回 `unrun`——如果不单独报出来，清单会替一条
   * **零覆盖**的 spec 背书。
   */
  it("条件豁免的 spec 连条件覆盖都没了 ⇒ 陈旧，要红（而不是安静地变 unrun）", () => {
    const { rows, staleConditionalExemptions } = classifySpecs({
      population: ["a.spec.ts"],
      coveredBy: new Map([["a.spec.ts", []]]),
      exemptions: [],
      conditionalExemptions: [{ spec: "a.spec.ts", reason: "当时有条件覆盖" }],
    });
    expect(rows[0].verdict).toBe("unrun");
    expect(staleConditionalExemptions).toEqual([
      { spec: "a.spec.ts", why: expect.stringContaining("没有任何 job") },
    ]);
  });

  it("条件豁免指向不存在的文件 ⇒ 陈旧，要红", () => {
    const { staleConditionalExemptions } = classifySpecs({
      population: ["a.spec.ts"],
      coveredBy: new Map([["a.spec.ts", [covers("x.config.ts", true)]]]),
      exemptions: [],
      conditionalExemptions: [{ spec: "gone.spec.ts", reason: "文件早没了" }],
    });
    expect(staleConditionalExemptions).toEqual([
      { spec: "gone.spec.ts", why: expect.stringContaining("不存在") },
    ]);
  });
});

describe("豁免清单的自律", () => {
  it("每条豁免都写了非空理由 —— 清单每加一项门控就松一分，理由要能被下一个人核", () => {
    for (const exemption of [...EXEMPTIONS, ...CONDITIONAL_COVERAGE_EXEMPTIONS] as Exemption[]) {
      expect(exemption.reason?.trim().length ?? 0).toBeGreaterThan(80);
    }
  });

  it("同一条 spec 不许同时出现在两份清单里 —— 两份清单说的是两回事，同时署名说明有人没想清楚", () => {
    const unrun = new Set((EXEMPTIONS as Exemption[]).map((e) => e.spec));
    const both = (CONDITIONAL_COVERAGE_EXEMPTIONS as Exemption[]).filter((e) => unrun.has(e.spec));
    expect(both.map((e) => e.spec)).toEqual([]);
  });
});

describe("真实仓库", () => {
  it("从 CI 出发能追到被真正调用的 config —— 且 chat-read 现在在其中（#512 的修复本身）", () => {
    const invoked = invokedConfigs().map((c) => c.configPath);
    // 正样本：这三条在本次修复后都必须可达。
    expect(invoked).toContain("apps/web/playwright.fullstack-smoke.config.ts");
    expect(invoked).toContain("apps/devportal/playwright.config.ts");
    expect(invoked).toContain("apps/web/playwright.chat-read.config.ts");
  });

  it("总体不为空 —— 空总体会让门控恒绿（本仓已九次「全绿但空转」）", () => {
    expect(allSpecFiles().length).toBeGreaterThan(0);
  });

  it("当前仓库没有 unrun、也没有未署名的条件覆盖", () => {
    const { rows, staleConditionalExemptions } = auditSpecGateCoverage() as {
      rows: Row[];
      staleConditionalExemptions: unknown[];
    };
    expect(rows.filter((r) => r.verdict === "unrun").map((r) => r.spec)).toEqual([]);
    expect(rows.filter((r) => r.verdict === "covered-but-exempt")).toEqual([]);
    expect(rows.filter((r) => r.verdict === "conditionally-covered").map((r) => r.spec)).toEqual([]);
    expect(staleConditionalExemptions).toEqual([]);
  });

  /**
   * #523 在真实仓库上的那条事实：`deploy-devportal.yml` 带 `paths: apps/devportal/**`，
   * 所以它接住的 config 只能算**条件**覆盖。这条断言是本次修复的正样本——
   * 若哪天有人把 devportal e2e 接进无条件 job（出路 (b)），它会翻绿并逼着删掉
   * `CONDITIONAL_COVERAGE_EXEMPTIONS` 里对应的六条，这正是我们要的联动。
   */
  it("path-filtered 的 deploy-devportal 只算条件覆盖；无条件门控仍算无条件", () => {
    const invoked = new Map(invokedConfigs().map((c) => [c.configPath, c]));
    expect(invoked.get("apps/devportal/playwright.config.ts")?.unconditional).toBe(false);
    expect(invoked.get("apps/web/playwright.fullstack-smoke.config.ts")?.unconditional).toBe(true);
    expect(invoked.get("apps/web/playwright.chat-read.config.ts")?.unconditional).toBe(true);
  });

  it("门控脚本本身以 0 退出", () => {
    expect(() => execFileSync("node", [GATE], { encoding: "utf8" })).not.toThrow();
  });
});

describe("反证：门控真的会红", () => {
  /**
   * ⚠ 第一版反证是「把 capability-mutate-smoke.spec.ts 从磁盘上删掉」——它确实红了，
   *   但红在总体里少了一个文件，**根本没走到覆盖判定**。那测的是 git ls-files，不是门控。
   *
   * 这一版把接缝隔离开：文件仍在 `testDir` 下、仍存在于总体里，只是不在任何 project 的
   * `testMatch` 里。这正是 issue 点名的那种误判——「一个 spec 在 testDir 下不等于它会被跑」。
   * 判决必须从 covered 翻成 unrun，而不是从总体里消失。
   */
  it("把一个在跑的 spec 移出 testMatch（文件仍在 testDir 下）⇒ 判决翻成 unrun", () => {
    const population = allSpecFiles();
    const victim = "apps/web/e2e/capability-mutate-smoke.spec.ts";
    expect(population).toContain(victim); // 正样本：动手前它确实在总体里

    const before = classifySpecs({
      population,
      coveredBy: new Map([[victim, [covers("apps/web/playwright.fullstack-smoke.config.ts")]]]),
      exemptions: [],
    });
    expect((before.rows as Row[]).find((r) => r.spec === victim)!.verdict).toBe("covered");

    // 唯一的变化：这份 config 的 testMatch 不再匹配它。文件、总体、路径都没动。
    const after = classifySpecs({
      population,
      coveredBy: new Map([[victim, []]]),
      exemptions: [],
    });
    expect((after.rows as Row[]).find((r) => r.spec === victim)!.verdict).toBe("unrun");
  });
});

/**
 * #523 的端到端反证：**把某条 spec 的唯一来源改成 path-filtered job，
 * 门控必须把它从「无条件覆盖」降级并报出来。**
 *
 * 这一层不碰真实 `.github/`，而是在临时目录上搭一个最小仓库骨架，让整条链路
 * （workflow YAML → job 条件 → `pnpm run` 展开 → playwright config）真的跑一遍。
 * 只在 `classifySpecs` 上传个 `unconditional: false` 进去证明不了判据本身：
 * 那只测了最后一格，而 #523 的洞在**第一格**（谁是起点、那个起点什么时候来）。
 *
 * ⚠ 红线 10：红了也要问是不是因为对的原因红的。所以对照组与实验组的 workflow
 * **逐字节相同，只多出一个 `paths:` 块**——下面第一条断言就是在钉这件事，
 * 免得哪天判决翻面其实是因为 job 改了名、命令换了写法。
 */
describe("反证（#523）：path-filtered 起点必须被降级", () => {
  const roots: string[] = [];
  afterAll(() => {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
  });

  /** 除了 `paths:`，两份骨架一模一样。 */
  function workflowYaml(pathFiltered: boolean) {
    const filter = pathFiltered ? "    paths:\n      - \"apps/fixture/**\"\n" : "";
    return [
      "name: fixture",
      "on:",
      "  pull_request:",
      filter + "  push:",
      "    branches: [main]",
      filter + "jobs:",
      "  e2e:",
      "    runs-on: ubuntu-latest",
      "    steps:",
      "      - run: pnpm --filter @repo/fixture run e2e",
      "",
    ].join("\n");
  }

  function scaffold(pathFiltered: boolean) {
    const root = mkdtempSync(path.join(tmpdir(), "spec-gate-523-"));
    roots.push(root);
    mkdirSync(path.join(root, ".github", "workflows"), { recursive: true });
    mkdirSync(path.join(root, "apps", "fixture"), { recursive: true });
    writeFileSync(path.join(root, ".github", "workflows", "fixture.yml"), workflowYaml(pathFiltered));
    writeFileSync(
      path.join(root, "apps", "fixture", "package.json"),
      JSON.stringify({ name: "@repo/fixture", scripts: { e2e: "playwright test" } }),
    );
    writeFileSync(path.join(root, "apps", "fixture", "playwright.config.ts"), "export default {};\n");
    return root;
  }

  it("对照组与实验组的差别**只有** paths:（否则下面的翻面不能归因）", () => {
    const without = workflowYaml(false).split("\n");
    const withFilter = workflowYaml(true).split("\n");
    const added = withFilter.filter((line) => !without.includes(line));
    expect([...new Set(added)]).toEqual(["    paths:", '      - "apps/fixture/**"']);
    // 反向：实验组没有删掉对照组的任何一行。
    expect(without.every((line) => withFilter.includes(line))).toBe(true);
  });

  it("同一个 job、同一条命令：加上 paths: 之后，覆盖从无条件降级为条件", () => {
    const unconditional = invokedConfigs(scaffold(false));
    expect(unconditional).toMatchObject([
      { configPath: "apps/fixture/playwright.config.ts", unconditional: true, via: ["fixture.yml#e2e"] },
    ]);

    const filtered = invokedConfigs(scaffold(true));
    // 起点还在（via 一字未变），变的只是「它什么时候来」。
    expect(filtered).toMatchObject([
      { configPath: "apps/fixture/playwright.config.ts", unconditional: false, via: ["fixture.yml#e2e"] },
    ]);
  });

  it("降级后判决从 covered 翻成 conditionally-covered —— 门控会报出来，不再替它报绿", () => {
    const spec = "apps/fixture/e2e/smoke.spec.ts";
    const verdictFor = (pathFiltered: boolean) => {
      const invoked = invokedConfigs(scaffold(pathFiltered));
      const coveredBy = new Map([[spec, invoked.map((c) => covers(c.configPath, c.unconditional))]]);
      const { rows } = classifySpecs({ population: [spec], coveredBy, exemptions: [], conditionalExemptions: [] });
      return rows[0] as Row;
    };

    expect(verdictFor(false).verdict).toBe("covered");

    const downgraded = verdictFor(true);
    expect(downgraded.verdict).toBe("conditionally-covered");
    expect(downgraded.unconditionalBy).toEqual([]);
    expect(downgraded.conditionalBy).toEqual(["apps/fixture/playwright.config.ts"]);
  });
});
