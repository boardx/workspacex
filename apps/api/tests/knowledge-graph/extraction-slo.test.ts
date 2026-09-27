/**
 * S8（#4365）—— 抽取 SLO：p95 延迟、失败率、卡住的租约有值；超阈值告警（worker 的 error 日志只在进入 / 变化时记一次，
 * 恢复记 info）；阈值从环境变量读。卡住的租约的数据库现数另见 consolidation-db.test.ts 的 SLO 一节（真实队列）。
 */
import { describe, expect, it } from "vitest";
import { ExtractionSloRecorder, SLO_WINDOW_MS } from "../../src/application/knowledge-graph/extraction-slo-recorder";
import {
  EXTRACTION_SLO_DEFAULTS, evaluateExtractionSlo, percentile, readExtractionSloThresholds,
} from "../../src/domain/knowledge-graph/extraction-slo";
import type { OrgId } from "../../src/domain/org-id";
import { KgExtractionWorker } from "../../src/infrastructure/knowledge-graph/kg-extraction-worker";

describe("#4365 指标计算", () => {
  it("p95（nearest-rank）：空 ⇒ null；1..100 ⇒ 95；单个 ⇒ 它本身", () => {
    expect(percentile([], 95)).toBeNull();
    expect(percentile(Array.from({ length: 100 }, (_, i) => i + 1), 95)).toBe(95);
    expect(percentile([42], 95)).toBe(42);
    expect(percentile([5, 1, 3], 50)).toBe(3);
  });

  it("记录器：窗口内的 p95 / 失败率；门控跳过的不进失败率分母；超出窗口的样本不算", () => {
    let now = 1_000_000;
    const r = new ExtractionSloRecorder(() => now);
    r.recordJob(100, "written");
    r.recordJob(300, "failed");
    r.recordJob(200, "empty");
    r.recordJob(5, "skipped", true);
    expect(r.window()).toEqual({
      windowSeconds: SLO_WINDOW_MS / 1000, processed: 4, modelJobs: 3, failed: 1, p95LatencyMs: 300, failureRate: 1 / 3,
    });
    now += SLO_WINDOW_MS + 1;
    r.recordJob(50, "written");
    expect(r.window()).toMatchObject({ processed: 1, modelJobs: 1, failed: 0, p95LatencyMs: 50, failureRate: 0 });
  });

  it("阈值：默认值；环境变量覆盖；非法值回默认（失败率 > 1 也回默认）", () => {
    expect(readExtractionSloThresholds({})).toEqual(EXTRACTION_SLO_DEFAULTS);
    expect(readExtractionSloThresholds({ KG_EXTRACTION_SLO_P95_MS: "5000", KG_EXTRACTION_SLO_FAILURE_RATE: "0.05", KG_EXTRACTION_SLO_STUCK_LEASES: "2" }))
      .toEqual({ p95LatencyMs: 5000, failureRate: 0.05, stuckLeases: 2 });
    expect(readExtractionSloThresholds({ KG_EXTRACTION_SLO_P95_MS: "abc", KG_EXTRACTION_SLO_FAILURE_RATE: "3", KG_EXTRACTION_SLO_STUCK_LEASES: "-1" }))
      .toEqual(EXTRACTION_SLO_DEFAULTS);
  });

  it("判定：三个指标各自超阈值才报；失败率样本太少不报", () => {
    const t = { p95LatencyMs: 1000, failureRate: 0.2, stuckLeases: 0 };
    expect(evaluateExtractionSlo({ p95LatencyMs: 900, failureRate: 0.1, samples: 10, stuckLeases: 0 }, t)).toEqual([]);
    expect(evaluateExtractionSlo({ p95LatencyMs: 1500, failureRate: 0.5, samples: 10, stuckLeases: 2 }, t)).toEqual([
      { metric: "p95_latency", value: 1500, threshold: 1000 },
      { metric: "failure_rate", value: 0.5, threshold: 0.2 },
      { metric: "stuck_leases", value: 2, threshold: 0 },
    ]);
    expect(evaluateExtractionSlo({ p95LatencyMs: null, failureRate: 1, samples: 1, stuckLeases: 0 }, t)).toEqual([]);
  });
});

describe("#4365 worker 告警：进入超标记 error（一次）、恢复记 info", () => {
  function harness(stuck: { n: number }) {
    const lines: { level: string; msg: string; data: Record<string, unknown> }[] = [];
    const logger = {
      info: (msg: string, data?: Record<string, unknown>) => { lines.push({ level: "info", msg, data: data ?? {} }); },
      error: (msg: string, data?: Record<string, unknown>) => { lines.push({ level: "error", msg, data: data ?? {} }); },
    };
    const slo = new ExtractionSloRecorder();
    const counts = { counts: async () => ({ stuckLeases: stuck.n, deadLetters: 0, backlog: 0, oldestPendingSeconds: 0 }) };
    const queue = { pendingOrgs: async (): Promise<readonly OrgId[]> => [], claim: async () => [], complete: async () => undefined, fail: async () => undefined };
    const worker = new KgExtractionWorker(
      { enabled: true, provider: "loopback", modelId: "m" }, queue as never, {} as never, {} as never, {} as never,
      { pendingCloseOrgs: async () => [], drainCloseOne: async () => false } as never, {} as never, logger as never, 1_000,
      slo, counts, { p95LatencyMs: 1_000, failureRate: 0.2, stuckLeases: 0 }, null,
    );
    return { worker, lines, slo };
  }

  it("卡住的租约 > 阈值 ⇒ 一条 error（带指标、值、阈值、错误码）；同样的超标不重复记；恢复 ⇒ info", async () => {
    const stuck = { n: 2 };
    const h = harness(stuck);
    await h.worker.checkSlo(true);
    await h.worker.checkSlo(true);
    expect(h.lines.filter((l) => l.msg === "kg extraction slo breached")).toHaveLength(1);
    expect(h.lines[0]).toMatchObject({
      level: "error", data: { code: "KG_EXTRACTION_SLO_BREACHED", alerts: [{ metric: "stuck_leases", value: 2, threshold: 0 }] },
    });
    // 又多了一项超标（p95）⇒ 集合变了，再记一次
    for (let i = 0; i < 5; i += 1) h.slo.recordJob(5_000, "written");
    await h.worker.checkSlo(true);
    expect(h.lines.filter((l) => l.msg === "kg extraction slo breached")).toHaveLength(2);
    stuck.n = 0;
    for (let i = 0; i < 200; i += 1) h.slo.recordJob(10, "written");
    await h.worker.checkSlo(true);
    expect(h.lines.at(-1)).toMatchObject({ level: "info", msg: "kg extraction slo recovered" });
  });

  it("不带 force 时一分钟内只判一次（每次要数全库）", async () => {
    let calls = 0;
    const h = harness({ n: 0 });
    (h.worker as unknown as { sloCounts: { counts: () => Promise<unknown> } }).sloCounts = {
      counts: async () => { calls += 1; return { stuckLeases: 0, deadLetters: 0, backlog: 0, oldestPendingSeconds: 0 }; },
    };
    await h.worker.checkSlo();
    await h.worker.checkSlo();
    expect(calls).toBe(1);
  });
});
