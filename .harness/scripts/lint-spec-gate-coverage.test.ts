/**
 * #512 门控的反证套件。
 *
 * 两层，缺一不可：
 *  · **纯判定层**（`classifySpecs`）：对构造输入断言四种判决。四种里有两种在真实仓库
 *    （希望）永远不出现——`covered-but-exempt` 与陈旧豁免——而永远不出现的分支正是
 *    最容易写错又永远测不到的那种。
 *  · **真实仓库层**：锁住本次修复的事实，以及「门控本身没在空转」。
 *
 * ⚠ 反证的第一版红在了它想测的那一步**之前**（详见 `describe("反证")` 里的注释），
 *   本套件保留了把接缝隔离开的那个版本。红了不等于测到了。
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  allSpecFiles,
  auditSpecGateCoverage,
  classifySpecs,
  EXEMPTIONS,
  resolveInvokedConfigs,
} from "./lint-spec-gate-coverage.mjs";

const GATE = fileURLToPath(new URL("./lint-spec-gate-coverage.mjs", import.meta.url));

describe("判定逻辑（纯函数）", () => {
  it("被某个 config 跑到 ⇒ covered", () => {
    const { rows } = classifySpecs({
      population: ["a.spec.ts"],
      coveredBy: new Map([["a.spec.ts", ["x.config.ts"]]]),
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
      coveredBy: new Map([["a.spec.ts", ["x.config.ts"]]]),
      exemptions: [{ spec: "a.spec.ts", reason: "早就不需要了" }],
    });
    expect(rows[0].verdict).toBe("covered-but-exempt");
  });

  it("豁免指向不存在的文件 ⇒ 报为 stale（改名/删除后忘了同步）", () => {
    const { staleExemptions } = classifySpecs({
      population: ["a.spec.ts"],
      coveredBy: new Map([["a.spec.ts", ["x.config.ts"]]]),
      exemptions: [{ spec: "gone.spec.ts", reason: "文件早没了" }],
    });
    expect(staleExemptions).toEqual(["gone.spec.ts"]);
  });
});

describe("豁免清单的自律", () => {
  it("每条豁免都写了非空理由 —— 清单每加一项门控就松一分，理由要能被下一个人核", () => {
    for (const exemption of EXEMPTIONS) {
      expect(exemption.reason?.trim().length ?? 0).toBeGreaterThan(80);
    }
  });
});

describe("真实仓库", () => {
  it("从 CI 出发能追到被真正调用的 config —— 且 chat-read 现在在其中（#512 的修复本身）", () => {
    const invoked = resolveInvokedConfigs().map((c) => c.configPath);
    // 正样本：这三条在本次修复后都必须可达。
    expect(invoked).toContain("apps/web/playwright.fullstack-smoke.config.ts");
    expect(invoked).toContain("apps/devportal/playwright.config.ts");
    expect(invoked).toContain("apps/web/playwright.chat-read.config.ts");
  });

  it("总体不为空 —— 空总体会让门控恒绿（本仓已九次「全绿但空转」）", () => {
    expect(allSpecFiles().length).toBeGreaterThan(0);
  });

  it("当前仓库没有 unrun 的 spec", () => {
    const { rows } = auditSpecGateCoverage();
    expect(rows.filter((r) => r.verdict === "unrun").map((r) => r.spec)).toEqual([]);
    expect(rows.filter((r) => r.verdict === "covered-but-exempt")).toEqual([]);
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
      coveredBy: new Map([[victim, ["apps/web/playwright.fullstack-smoke.config.ts"]]]),
      exemptions: [],
    });
    expect(before.rows.find((r) => r.spec === victim)!.verdict).toBe("covered");

    // 唯一的变化：这份 config 的 testMatch 不再匹配它。文件、总体、路径都没动。
    const after = classifySpecs({
      population,
      coveredBy: new Map([[victim, []]]),
      exemptions: [],
    });
    expect(after.rows.find((r) => r.spec === victim)!.verdict).toBe("unrun");
  });
});
