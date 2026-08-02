/**
 * F139 -- `uc-23-6` R9 非功能约束 / R12 验收线索 10.
 *
 * 🔴 **"最近一次扫描时间"必须可观测，扫描停摆时它会变旧，而不是静默。** `lastScanAt` in
 * `scanReviewClocks`'s `out` is that indicator (contract's own comment: "不要把它挪进日志").
 * This file asserts:
 *   1. `lastScanAt` always equals the `now` the caller passed in -- every call, regardless of
 *      whether it transitions or downgrades anything (T1 sweep empty, T2 sweep empty, or both).
 *   2. Calling the scan again with a later `now` produces a later `lastScanAt` -- i.e. it is a
 *      live signal each call updates, not a value frozen at first-ever-scan time.
 *   3. A caller can tell "the scanner stopped running" apart from "the scanner ran and found
 *      nothing to do" purely from `lastScanAt` going stale relative to wall-clock time, because
 *      the field is present on every response, not just ones with activity.
 */
import { describe, expect, it } from "vitest";
import { scanReviewClocks } from "../../src/application/asset/scan-review-clocks";
import type { ReviewClockRecord } from "../../src/domain/asset/asset-review-clock";
import type { AssetGovernanceRecord, AssetGovernanceRepository, ReviewClockRepository } from "../../src/application/asset/ports";

class InMemoryReviewClocks implements ReviewClockRepository {
  private readonly store = new Map<string, ReviewClockRecord>();
  async get(assetKind: string, assetId: string) {
    return this.store.get(`${assetKind}:${assetId}`) ?? null;
  }
  async save(record: ReviewClockRecord) {
    this.store.set(`${record.assetKind}:${record.assetId}`, record);
  }
  async listActive() {
    return [...this.store.values()].filter((r) => r.state === "active");
  }
  async listPendingReview() {
    return [...this.store.values()].filter((r) => r.state === "pending-review");
  }
}

class InMemoryGovernanceRepo implements AssetGovernanceRepository {
  private readonly store = new Map<string, AssetGovernanceRecord>();
  async get(assetKind: string, assetId: string) {
    return this.store.get(`${assetKind}:${assetId}`) ?? null;
  }
  async set(assetKind: string, assetId: string, governance: AssetGovernanceRecord) {
    this.store.set(`${assetKind}:${assetId}`, governance);
  }
}

describe("uc-23-6 R9/R12-10: lastScanAt 始终可观测", () => {
  it("完全空仓库（无任何时钟）扫描仍然返回 lastScanAt = 传入的 now", async () => {
    const reviewClocks = new InMemoryReviewClocks();
    const governance = new InMemoryGovernanceRepo();
    const result = await scanReviewClocks({ reviewClocks, governance }, { now: "2026-03-01T00:00:00.000Z" });
    expect(result.lastScanAt).toBe("2026-03-01T00:00:00.000Z");
    expect(result.transitionedToPending).toEqual([]);
    expect(result.downgraded).toEqual([]);
  });

  it("T1 与 T2 都有活动时，lastScanAt 仍然精确等于 now（不是活动时间戳的派生值）", async () => {
    const reviewClocks = new InMemoryReviewClocks();
    const governance = new InMemoryGovernanceRepo();
    await reviewClocks.save({
      assetKind: "skill",
      assetId: "due-now",
      state: "active",
      publishedAt: "2025-06-01T00:00:00.000Z",
      reviewDueAt: "2026-01-01T00:00:00.000Z",
      downgradeDueAt: null,
      lastReviewedAt: null,
      lastReviewedBy: null,
    });
    await reviewClocks.save({
      assetKind: "skill",
      assetId: "downgrade-now",
      state: "pending-review",
      publishedAt: "2024-01-01T00:00:00.000Z",
      reviewDueAt: "2025-01-01T00:00:00.000Z",
      downgradeDueAt: "2026-01-31T00:00:00.000Z",
      lastReviewedAt: null,
      lastReviewedBy: null,
    });
    await governance.set("skill", "downgrade-now", {
      visibility: "whole-org",
      teamIds: [],
      editableBy: ["u-owner"],
      ownerId: "u-owner",
      reviewCycle: "6m",
    });

    const result = await scanReviewClocks({ reviewClocks, governance }, { now: "2026-02-15T12:34:56.000Z" });

    expect(result.transitionedToPending.length).toBe(1);
    expect(result.downgraded.length).toBe(1);
    expect(result.lastScanAt).toBe("2026-02-15T12:34:56.000Z");
  });

  it("连续两次扫描：第二次的 lastScanAt 晚于第一次（不是缓存住的第一次结果）", async () => {
    const reviewClocks = new InMemoryReviewClocks();
    const governance = new InMemoryGovernanceRepo();

    const first = await scanReviewClocks({ reviewClocks, governance }, { now: "2026-04-01T00:00:00.000Z" });
    const second = await scanReviewClocks({ reviewClocks, governance }, { now: "2026-04-01T00:05:00.000Z" });

    expect(first.lastScanAt).toBe("2026-04-01T00:00:00.000Z");
    expect(second.lastScanAt).toBe("2026-04-01T00:05:00.000Z");
    expect(second.lastScanAt > first.lastScanAt).toBe(true);
  });
});
