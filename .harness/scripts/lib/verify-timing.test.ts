// verify-timing.test.ts — 用注入的假时钟推进时间，不靠真实 sleep（测试不该等秒表）。
import { describe, expect, it, afterEach } from "vitest";
import { rmSync } from "node:fs";
import {
  Stopwatch,
  computeStats,
  checkBudget,
  formatDuration,
  recordRun,
  readAllRuns,
  timingsPath,
  type TimingRun,
} from "./verify-timing";

function fakeClock(startMs: number) {
  let now = startMs;
  return {
    tick: (ms: number) => {
      now += ms;
    },
    now: () => now,
  };
}

describe("verify-timing", () => {
  afterEach(() => {
    try {
      rmSync(timingsPath());
    } catch {
      /* 本来就不存在也没关系，不留痕迹污染真实缓存 */
    }
  });

  it("Stopwatch：按 start/stop 顺序正确累计各阶段耗时", () => {
    const clock = fakeClock(0);
    const sw = new Stopwatch(clock.now);
    sw.start("等待资源");
    clock.tick(2_000);
    sw.start("命令执行"); // 隐式 stop 上一阶段
    clock.tick(5_000);
    sw.stop();
    const run = sw.finish("verify:quick", "run-1");

    expect(run.phases).toEqual([
      { name: "等待资源", ms: 2_000 },
      { name: "命令执行", ms: 5_000 },
    ]);
    expect(run.totalMs).toBe(7_000);
  });

  it("忘记 stop 最后一个阶段：finish 时自动收尾，不丢数据", () => {
    const clock = fakeClock(0);
    const sw = new Stopwatch(clock.now);
    sw.start("编译");
    clock.tick(3_000);
    const run = sw.finish("verify:release", "run-2"); // 没手动 stop
    expect(run.phases).toEqual([{ name: "编译", ms: 3_000 }]);
  });

  it("formatDuration：跨分钟正确换算，不满一分钟只显示秒", () => {
    expect(formatDuration(45_000)).toBe("45s");
    expect(formatDuration(90_000)).toBe("1m30s");
    expect(formatDuration(600_000)).toBe("10m0s");
  });

  it("computeStats：p50/p95 按阶段名聚合，__total__ 是总耗时的聚合，不是某个阶段", () => {
    const runs: TimingRun[] = [10, 20, 30, 40, 50].map((ms, i) => ({
      runId: `r${i}`,
      command: "verify:quick",
      startedAt: new Date(0).toISOString(),
      phases: [{ name: "定向测试", ms: ms * 1000 }],
      totalMs: ms * 1000 + 1000,
    }));
    const stats = computeStats(runs);
    const quickStat = stats.find((s) => s.name === "定向测试")!;
    expect(quickStat.count).toBe(5);
    expect(quickStat.p50Ms).toBe(30_000); // 中位数
    expect(quickStat.p95Ms).toBe(50_000); // 5 个值的 p95 落在最大值

    const totalStat = stats.find((s) => s.name === "__total__")!;
    expect(totalStat.count).toBe(5);
  });

  it("反证：checkBudget 只在真的超预算时报警，没超不报警", () => {
    const run: TimingRun = {
      runId: "r1",
      command: "verify:release",
      startedAt: new Date(0).toISOString(),
      phases: [{ name: "集成测试", ms: 400_000 }],
      totalMs: 450_000,
    };
    const overBudget = checkBudget(run, [{ phaseName: "集成测试", maxMs: 300_000 }]);
    expect(overBudget).toHaveLength(1);
    expect(overBudget[0]).toContain("集成测试");

    const withinBudget = checkBudget(run, [{ phaseName: "集成测试", maxMs: 500_000 }]);
    expect(withinBudget).toHaveLength(0);
  });

  it("recordRun + readAllRuns：写入的记录能原样读回", () => {
    const run: TimingRun = {
      runId: "r-persist",
      command: "verify:harness",
      startedAt: new Date(0).toISOString(),
      phases: [{ name: "控制平面", ms: 41_000 }],
      totalMs: 41_000,
    };
    recordRun(run);
    const all = readAllRuns();
    expect(all).toHaveLength(1);
    expect(all[0]).toEqual(run);
  });
});
