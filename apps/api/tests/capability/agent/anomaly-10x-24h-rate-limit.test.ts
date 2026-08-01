/**
 * F60 / O-36 第 3 项 / V20 / V6 -- 异常检测按 24 小时滚动窗口均值 10 倍触发自动限速；
 * 越权调用被拦截并计数。
 *
 * `user_visible_behavior`: 「异常检测按 24 小时滚动窗口均值 10 倍触发自动限速，越权调用被
 * 拦截并计数。」
 * V20: 把某人调用量推到 24 小时滚动窗口均值的 10 倍以上 → 触发额度异常并自动限速；
 * 9 倍时不触发。
 */
import { describe, expect, it } from "vitest";
import {
  QUOTA_ANOMALY_MULTIPLIER,
  QUOTA_ANOMALY_WINDOW_HOURS,
  ProvenanceWriteFailedError,
  ReviewReasonRequiredError,
  detectQuotaAnomaly,
  interceptUnauthorizedCall,
  markAnomalyNormal,
  raiseQuotaAnomaly,
} from "../../../src/domain/agent/anomaly-detection";

describe("F60 O-36 第 3 项 -- 阈值裁决值", () => {
  it("倍数恒为 10，窗口恒为 24 小时", () => {
    expect(QUOTA_ANOMALY_MULTIPLIER).toBe(10);
    expect(QUOTA_ANOMALY_WINDOW_HOURS).toBe(24);
  });
});

describe("F60 V20 -- 10 倍触发，9 倍不触发（判据是相对均值的倍数，不是绝对阈值）", () => {
  it("当前窗口调用量 = 均值的 10 倍 ⇒ 触发", () => {
    const verdict = detectQuotaAnomaly({ baselineAverage: 40, currentWindowCount: 400 });
    expect(verdict.triggered).toBe(true);
    expect(verdict.multiplier).toBe(10);
  });

  it("反向断言：9 倍不触发（证明不是恒触发的实现）", () => {
    const verdict = detectQuotaAnomaly({ baselineAverage: 40, currentWindowCount: 360 });
    expect(verdict.triggered).toBe(false);
    expect(verdict.multiplier).toBeCloseTo(9);
  });

  it("原型场景：单人单日消耗超均值 11 倍（428 次 / 均值约 38.9）⇒ 触发", () => {
    const verdict = detectQuotaAnomaly({ baselineAverage: 38.9, currentWindowCount: 428 });
    expect(verdict.triggered).toBe(true);
  });

  it("无历史基线（均值为 0）⇒ 不触发，不产生除零导致的假阳性", () => {
    const verdict = detectQuotaAnomaly({ baselineAverage: 0, currentWindowCount: 999 });
    expect(verdict.triggered).toBe(false);
    expect(verdict.multiplier).toBe(0);
  });
});

describe("F60 -- 命中额度异常 ⇒ 自动限速（系统动作，不等人）且对当事人可见", () => {
  it("triggered=true ⇒ Anomaly.rateLimited=true 且 visibleToSubject 恒为 true", () => {
    const writer = { write: () => ({ ok: true }) };
    const anomaly = raiseQuotaAnomaly(
      {
        anomalyId: "anom-1",
        subjectId: "user-wu",
        verdict: { triggered: true, multiplier: 11 },
        detectedAt: "2026-07-18T03:12:00Z",
      },
      writer,
    );
    expect(anomaly.rateLimited).toBe(true);
    expect(anomaly.severity).toBe("高");
    expect(anomaly.visibleToSubject).toBe(true);
    expect(anomaly.handled).toBe(false);
  });

  it("审计写入失败 ⇒ 抛 ProvenanceWriteFailedError（限速本身也是审计事件，写不进去就不能宣称已处理）", () => {
    const writer = { write: () => ({ ok: false }) };
    expect(() =>
      raiseQuotaAnomaly(
        {
          anomalyId: "anom-2",
          subjectId: "user-wu",
          verdict: { triggered: true, multiplier: 11 },
          detectedAt: "2026-07-18T03:12:00Z",
        },
        writer,
      ),
    ).toThrow(ProvenanceWriteFailedError);
  });
});

describe("F60 V6 -- 越权调用必须拦截并计数，不是仅记录", () => {
  it("首次越权尝试 ⇒ 计数为 1", () => {
    const counters = new Map<string, number>();
    const writer = { write: () => ({ ok: true }) };
    const result = interceptUnauthorizedCall(counters, "agt-rogue", writer);
    expect(result).toEqual({ agentId: "agt-rogue", count: 1 });
  });

  it("反复越权尝试 7 次 ⇒ 计数递增到 7（原型逐字「已拦截 7 次」）", () => {
    const counters = new Map<string, number>();
    const writer = { write: () => ({ ok: true }) };
    let last;
    for (let i = 0; i < 7; i += 1) {
      last = interceptUnauthorizedCall(counters, "agt-rogue", writer);
    }
    expect(last).toEqual({ agentId: "agt-rogue", count: 7 });
  });

  it("不同 agent 的计数互不影响", () => {
    const counters = new Map<string, number>();
    const writer = { write: () => ({ ok: true }) };
    interceptUnauthorizedCall(counters, "agt-a", writer);
    interceptUnauthorizedCall(counters, "agt-a", writer);
    const b = interceptUnauthorizedCall(counters, "agt-b", writer);
    expect(counters.get("agt-a")).toBe(2);
    expect(b.count).toBe(1);
  });

  it("审计写入失败 ⇒ 抛错且不计数（拦截与留痕是同一个硬前置，不允许「拦截了但没留痕」）", () => {
    const counters = new Map<string, number>();
    const writer = { write: () => ({ ok: false }) };
    expect(() => interceptUnauthorizedCall(counters, "agt-rogue", writer)).toThrow(
      ProvenanceWriteFailedError,
    );
    expect(counters.get("agt-rogue")).toBeUndefined();
  });
});

describe("F60 -- [标记为正常] 须填理由才能解除限速", () => {
  it("给出理由 ⇒ 解除限速", () => {
    expect(markAnomalyNormal("确认为季末批量任务，非脚本循环")).toEqual({
      rateLimitReleased: true,
    });
  });

  it("反向断言：理由为空 ⇒ 抛 ReviewReasonRequiredError，不静默解除", () => {
    expect(() => markAnomalyNormal("")).toThrow(ReviewReasonRequiredError);
    expect(() => markAnomalyNormal("   ")).toThrow(ReviewReasonRequiredError);
  });
});
