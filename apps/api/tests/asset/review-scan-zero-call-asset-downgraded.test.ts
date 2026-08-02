/**
 * F139 -- `uc-23-6` R7 规则 4/7, R9 主动扫描, R12 验收线索 4/5/8.
 *
 * 🔴 **This file is the reverse-proof the issue calls out**: an asset that has NEVER been read
 * or called even once since entering `pending-review` must still be downgraded by the scheduled
 * scan -- degradation is driven by `ScanReviewClocks` reading `listPendingReview()` +
 * `downgradeDueAt`, never by a lazy check on a read path. None of the tests below ever call
 * `getReviewClock`, `getAssetDirectory`, or `readAssetFile` on the asset being downgraded --
 * that omission is the point: if a lazy ("`EvaluateOnRead…`") implementation were swapped in,
 * these assertions would fail because nothing here ever triggers the lazy check.
 *
 * Also covers R12 验收线索 5: the downgrade must go through the SAME visibility write path as
 * `SetAssetGovernance` (`writeAssetGovernanceVisibility`, I-14) -- asserted here behaviourally
 * (the governance record actually collapses to `private-draft`/`teamIds: []`), with the
 * structural "only one call site" half of that assertion covered by
 * `visibility-single-write-path.test.ts`.
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

/** A clock that has been sitting in `pending-review` for >= 30 days -- nobody ever reviewed it,
 *  and (crucially for this file) nobody ever even read/called it either. */
function longOverdueNeverCalledClock(overrides: Partial<ReviewClockRecord> = {}): ReviewClockRecord {
  return {
    assetKind: "skill",
    assetId: "never-called",
    state: "pending-review",
    publishedAt: "2025-01-01T00:00:00.000Z",
    reviewDueAt: "2026-01-01T00:00:00.000Z",
    downgradeDueAt: "2026-01-31T00:00:00.000Z", // 30 days after entering pending-review
    lastReviewedAt: null,
    lastReviewedBy: null,
    ...overrides,
  };
}

function governanceOf(overrides: Partial<AssetGovernanceRecord> = {}): AssetGovernanceRecord {
  return {
    visibility: "specified-teams",
    teamIds: ["team-energy"],
    editableBy: ["u-owner"],
    ownerId: "u-owner",
    reviewCycle: "12m",
    ...overrides,
  };
}

describe("uc-23-6 R9/R12-8: 零调用的到期资产也会被主动扫描降级", () => {
  it("从未被调用过的资产，扫描后被降级为仅负责人可见（private-draft, teamIds: []）", async () => {
    const reviewClocks = new InMemoryReviewClocks();
    const governance = new InMemoryGovernanceRepo();
    await reviewClocks.save(longOverdueNeverCalledClock());
    await governance.set("skill", "never-called", governanceOf());

    // Note: at no point before this call is `getReviewClock` / `getAssetDirectory` /
    // `readAssetFile` invoked for this asset -- the asset has genuinely zero calls.
    const result = await scanReviewClocks({ reviewClocks, governance }, { now: "2026-02-05T00:00:00.000Z" });

    expect(result.downgraded).toEqual([{ assetKind: "skill", assetId: "never-called" }]);

    const clockAfter = await reviewClocks.get("skill", "never-called");
    expect(clockAfter?.state).toBe("downgraded");
    expect(clockAfter?.downgradeDueAt).toBeNull();

    const governanceAfter = await governance.get("skill", "never-called");
    expect(governanceAfter?.visibility).toBe("private-draft");
    expect(governanceAfter?.teamIds).toEqual([]);
    // Owner / editableBy / reviewCycle are untouched -- downgrade collapses visibility only.
    expect(governanceAfter?.ownerId).toBe("u-owner");
    expect(governanceAfter?.editableBy).toEqual(["u-owner"]);
    expect(governanceAfter?.reviewCycle).toBe("12m");
  });

  it("反证：还没满 30 天的 pending-review 资产（同样零调用）不会被降级", async () => {
    const reviewClocks = new InMemoryReviewClocks();
    const governance = new InMemoryGovernanceRepo();
    await reviewClocks.save(
      longOverdueNeverCalledClock({ assetId: "not-yet-30-days", downgradeDueAt: "2099-01-01T00:00:00.000Z" }),
    );
    await governance.set("skill", "not-yet-30-days", governanceOf());

    const result = await scanReviewClocks({ reviewClocks, governance }, { now: "2026-02-05T00:00:00.000Z" });

    expect(result.downgraded).toEqual([]);
    const clockAfter = await reviewClocks.get("skill", "not-yet-30-days");
    expect(clockAfter?.state).toBe("pending-review");
    const governanceAfter = await governance.get("skill", "not-yet-30-days");
    expect(governanceAfter?.visibility).toBe("specified-teams");
  });

  it("反证：active 状态（尚未进入 pending-review）的资产不会被 T2 误伤", async () => {
    const reviewClocks = new InMemoryReviewClocks();
    const governance = new InMemoryGovernanceRepo();
    await reviewClocks.save({
      assetKind: "skill",
      assetId: "still-active",
      state: "active",
      publishedAt: "2026-01-01T00:00:00.000Z",
      reviewDueAt: "2099-01-01T00:00:00.000Z",
      downgradeDueAt: null,
      lastReviewedAt: null,
      lastReviewedBy: null,
    });
    await governance.set("skill", "still-active", governanceOf());

    const result = await scanReviewClocks({ reviewClocks, governance }, { now: "2026-02-05T00:00:00.000Z" });

    expect(result.downgraded).toEqual([]);
    const governanceAfter = await governance.get("skill", "still-active");
    expect(governanceAfter?.visibility).toBe("specified-teams");
  });

  it("端到端：从到期到降级的完整两段扫描，全程零调用（T1 与 T2 各跑一次扫描）", async () => {
    const reviewClocks = new InMemoryReviewClocks();
    const governance = new InMemoryGovernanceRepo();
    await reviewClocks.save({
      assetKind: "agent",
      assetId: "full-lifecycle",
      state: "active",
      publishedAt: "2025-01-01T00:00:00.000Z",
      reviewDueAt: "2026-01-01T00:00:00.000Z",
      downgradeDueAt: null,
      lastReviewedAt: null,
      lastReviewedBy: null,
    });
    await governance.set("agent", "full-lifecycle", governanceOf({ editableBy: ["u-owner2"], ownerId: "u-owner2" }));

    // Scan #1 -- T1 fires: active -> pending-review, downgradeDueAt populated (+30 days).
    const scan1 = await scanReviewClocks({ reviewClocks, governance }, { now: "2026-01-02T00:00:00.000Z" });
    expect(scan1.transitionedToPending).toEqual([{ assetKind: "agent", assetId: "full-lifecycle" }]);
    expect(scan1.downgraded).toEqual([]);
    const afterScan1 = await reviewClocks.get("agent", "full-lifecycle");
    expect(afterScan1?.state).toBe("pending-review");
    expect(afterScan1?.downgradeDueAt).toBe("2026-02-01T00:00:00.000Z");

    // Scan #2, run 40 days after scan #1's `now` -- T2 fires: pending-review -> downgraded.
    // The asset was never called/reviewed in between (this test never invokes any read path).
    const scan2 = await scanReviewClocks({ reviewClocks, governance }, { now: "2026-02-11T00:00:00.000Z" });
    expect(scan2.downgraded).toEqual([{ assetKind: "agent", assetId: "full-lifecycle" }]);

    const finalClock = await reviewClocks.get("agent", "full-lifecycle");
    expect(finalClock?.state).toBe("downgraded");

    const finalGovernance = await governance.get("agent", "full-lifecycle");
    expect(finalGovernance?.visibility).toBe("private-draft");
    expect(finalGovernance?.teamIds).toEqual([]);
  });
});
