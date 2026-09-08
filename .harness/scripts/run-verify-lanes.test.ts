import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { LANES, runLanes, summaryArtifact, type LaneSpec } from "./run-verify-lanes";

/**
 * #3094 的反证：旧形态 `verify:base:raw && verify:fullstack-smoke:raw` 下，
 * 前置单测红 ⇒ 浏览器 e2e lane **一条都不跑**，而 job 级 failure 读起来像
 * 「跑了且失败」。这里用注入的 runner 模拟「前置 lane 红」，断言：
 *   ① 后续 lane 仍然被调用（不短路）；
 *   ② 日志里两半各自的结果都写清楚了；
 *   ③ 整体退出码仍非零（不吞红）。
 * 末尾附上「撤掉修复」的对照：`&&` 语义的编排器在同一输入下漏跑第二条。
 */

function collect(lanes: LaneSpec[], codes: Record<string, number>) {
  const called: string[] = [];
  const lines: string[] = [];
  const { results, exitCode } = runLanes(
    lanes,
    (lane) => {
      called.push(lane.id);
      return codes[lane.id] ?? 0;
    },
    (line) => lines.push(line),
  );
  return { called, lines, results, exitCode, log: lines.join("\n") };
}

/** 对照组：修复前的 `&&` 语义，前一条非零就不再往下跑。 */
function runLanesShortCircuit(lanes: LaneSpec[], runLane: (l: LaneSpec) => number) {
  const called: string[] = [];
  for (const lane of lanes) {
    called.push(lane.id);
    if (runLane(lane) !== 0) break;
  }
  return called;
}

describe("verify:full 两条 lane 不再互相短路（#3094）", () => {
  it("前置单测 lane 红时，浏览器 e2e lane 仍然执行", () => {
    const { called, results, exitCode, log } = collect(LANES, { base: 1 });

    expect(called).toEqual(["base", "browser-e2e"]);
    expect(results.map((r) => [r.id, r.outcome])).toEqual([
      ["base", "failed"],
      ["browser-e2e", "passed"],
    ]);
    // 退出码仍反映红——修复不得用 `|| true` 把红吞掉。
    expect(exitCode).toBe(1);
    expect(log).toContain("❌ 已执行并失败");
    expect(log).toContain("✅ 已执行并通过");
  });

  it("撤掉修复（`&&` 语义）则回到短路：第二条 lane 根本没被调用", () => {
    const called = runLanesShortCircuit(LANES, (lane) => (lane.id === "base" ? 1 : 0));
    expect(called).toEqual(["base"]);
    expect(called).not.toContain("browser-e2e");
  });

  it("两条都红时退出码非零，且两条都被执行过", () => {
    const { called, exitCode, log } = collect(LANES, { base: 1, "browser-e2e": 2 });
    expect(called).toEqual(["base", "browser-e2e"]);
    expect(exitCode).toBe(1);
    expect(log).toContain("base(已执行并失败), browser-e2e(已执行并失败)");
  });

  it("lane 真的没跑起来时记 not-run，与「跑了且失败」在日志和产物里可区分", () => {
    const lines: string[] = [];
    const { results, exitCode } = runLanes(
      LANES,
      (lane) => {
        if (lane.id === "base") throw new Error("spawn 失败");
        return 0;
      },
      (line) => lines.push(line),
    );
    const log = lines.join("\n");
    expect(results.map((r) => r.outcome)).toEqual(["not-run", "not-run"]);
    // not-run 没有退出码，不许拿 0/1 冒充。
    expect(results.every((r) => r.exitCode === null)).toBe(true);
    expect(log).toContain("⏭ lane 未执行");
    expect(log).not.toContain("已执行并失败");
    expect(exitCode).toBe(1);
  });

  it("全绿时退出码为 0", () => {
    const { exitCode, log } = collect(LANES, {});
    expect(exitCode).toBe(0);
    expect(log).toContain("两条 lane 均执行并通过");
  });

  it("产物 JSON 逐 lane 记录 outcome，可区分「没跑」与「跑了且失败」", () => {
    const { results } = collect(LANES, { base: 1 });
    const parsed = JSON.parse(summaryArtifact(results)) as {
      lanes: { id: string; outcome: string; exitCode: number }[];
    };
    expect(parsed.lanes).toHaveLength(2);
    expect(parsed.lanes.find((l) => l.id === "browser-e2e")).toMatchObject({
      outcome: "passed",
      exitCode: 0,
    });
  });

  it("package.json 的 verify:full:raw 不再用 `&&` 串两条 lane", () => {
    const pkgPath = path.resolve(__dirname, "../../package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as {
      scripts: Record<string, string>;
    };
    const raw = pkg.scripts["verify:full:raw"];
    expect(raw).toContain("run-verify-lanes.ts");
    expect(raw).not.toContain("&&");
    // lane 表必须和 package.json 里真实存在的 script 对得上，别指向不存在的脚本。
    for (const lane of LANES) expect(pkg.scripts[lane.script]).toBeTruthy();
  });
});
