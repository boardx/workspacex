// 纯函数：逾期判定、聚合、健康分档、限流、契约拒绝（无 IO）。
import { TELEMETRY_REPORT_INTERVAL_SECONDS } from "@repo/contracts/instance-telemetry";
import { describe, expect, it } from "vitest";
import {
  OVERDUE_AFTER_MS,
  RATE_LIMIT_PER_HOUR,
  aggregateFleet,
  healthBucket,
  isOverdue,
  parseReport,
  rateLimit,
  summarize,
} from "../src/fleet";
import { makeReport } from "./helpers";

const T0 = Date.parse("2026-09-24T00:00:00Z");

describe("逾期 = 超过 2× 契约上报周期", () => {
  it("阈值取自契约", () => {
    expect(OVERDUE_AFTER_MS).toBe(2 * TELEMETRY_REPORT_INTERVAL_SECONDS * 1000);
  });
  it("边界：恰好 2× 不算逾期，多 1ms 算", () => {
    expect(isOverdue(T0, T0 + OVERDUE_AFTER_MS)).toBe(false);
    expect(isOverdue(T0, T0 + OVERDUE_AFTER_MS + 1)).toBe(true);
    expect(isOverdue(T0, T0 + TELEMETRY_REPORT_INTERVAL_SECONDS * 1000 * 1.5)).toBe(false);
  });
});

describe("聚合", () => {
  it("按版本 / 版次 / 健康计数，并列出逾期实例", async () => {
    const a = await makeReport({ seed: "a", productVersion: "1.2.0", edition: "cloud" });
    const b = await makeReport({ seed: "b", productVersion: "1.2.0", edition: "local", health: { uptimeRatio: 0.95 } });
    const c = await makeReport({ seed: "c", productVersion: "1.3.0", edition: "cloud", noHealth: true });
    const d = await makeReport({ seed: "d", productVersion: "1.3.0", edition: "cloud", health: { uptimeRatio: 0.5 } });
    const now = T0 + OVERDUE_AFTER_MS + 10;
    const p = aggregateFleet(
      [
        summarize({ receivedAt: now - 1000, report: a.report }),
        summarize({ receivedAt: now - 1000, report: b.report }),
        summarize({ receivedAt: T0, report: c.report }), // 逾期
        summarize({ receivedAt: now - 1000, report: d.report }),
      ],
      now,
    );
    expect(p.total).toBe(4);
    expect(p.byVersion).toEqual({ "1.2.0": 2, "1.3.0": 2 });
    expect(p.byEdition).toEqual({ cloud: 3, local: 1 });
    expect(p.health).toEqual({ healthy: 1, degraded: 1, down: 1, unreported: 1 });
    expect(p.overdue).toEqual([{ instanceId: c.report.instanceId, receivedAt: T0 }]);
    expect(p.reportIntervalSeconds).toBe(TELEMETRY_REPORT_INTERVAL_SECONDS);
  });
  it("空车队：计数为 0，不是缺字段", () => {
    const p = aggregateFleet([], T0);
    expect(p.total).toBe(0);
    expect(p.health).toEqual({ healthy: 0, degraded: 0, down: 0, unreported: 0 });
  });
  it("磁盘水位过高判 degraded", async () => {
    const r = await makeReport({ seed: "e", health: { diskUsedRatio: 0.95 } });
    expect(healthBucket(r.report)).toBe("degraded");
  });
});

describe("限流", () => {
  it(`滚动一小时内最多 ${RATE_LIMIT_PER_HOUR} 次，窗口过后恢复`, () => {
    let w: number[] = [];
    for (let i = 0; i < RATE_LIMIT_PER_HOUR; i++) {
      const r = rateLimit(w, T0 + i);
      expect(r.allowed).toBe(true);
      w = r.window;
    }
    expect(rateLimit(w, T0 + 100).allowed).toBe(false);
    expect(rateLimit(w, T0 + 3_600_001).allowed).toBe(true);
  });
});

describe("契约拒绝：自由文本不可能", () => {
  it("任何多余字段（顶层或分节内）都被拒", async () => {
    const { report } = await makeReport({ seed: "f" });
    expect(parseReport({ ...report, note: "客户说了一句话" }).success).toBe(false);
    expect(parseReport({ ...report, health: { ...report.health, message: "x" } }).success).toBe(false);
  });
  it("受约束字符串里塞不进句子", async () => {
    const { report } = await makeReport({ seed: "g" });
    expect(parseReport({ ...report, productVersion: "1.0.0 今天开会讨论了并购" }).success).toBe(false);
    expect(parseReport({ ...report, instanceId: "acme-corp" }).success).toBe(false);
    expect(
      parseReport({
        ...report,
        consent: { ...report.consent, diagnostics: true },
        diagnostics: { errorFingerprints: [{ fingerprint: "a".repeat(64), errorCode: "user said hello", count: 1 }] },
      }).success,
    ).toBe(false);
  });
  it("未同意的分节必须缺席；personal-local 声明必须为 true", async () => {
    const { report } = await makeReport({ seed: "h" });
    expect(parseReport({ ...report, consent: { ...report.consent, health: false } }).success).toBe(false);
    expect(parseReport({ ...report, excludesPersonalLocalOrgs: false }).success).toBe(false);
  });
});
