/**
 * F140 -- `uc-23-6` E1 ("负责人离职 / 账号停用") 的表达面.
 *
 * 🔴 E1 原文（`uc-23-6-复核到期与降级.md`）：「降级终态『仅负责人可见』会变成『谁都不可见』，
 * 资产事实上消失且无人能恢复……必须有一个兜底接管人（候选：平台组管理员 / 组织管理员）
 * → `[待确认]`」。**本文件只断言"这个态被表达出来"**（`ASSET_DOWNGRADED_OWNER_MISSING` +
 * `takeoverEntryPoint: true`），不断言、也不实现任何接管规则——兜底接管人是谁待人类裁决。
 */
import { describe, expect, it } from "vitest";
import { getAssetOrphanStatus } from "../../src/application/asset/get-asset-orphan-status";
import type { ReviewClockRecord } from "../../src/domain/asset/asset-review-clock";
import type { AssetGovernanceRecord, AssetGovernanceRepository, AssetOwnerStatusPort, ReviewClockRepository } from "../../src/application/asset/ports";

class FakeReviewClocks implements ReviewClockRepository {
  constructor(private readonly records: Map<string, ReviewClockRecord> = new Map()) {}
  async get(assetKind: string, assetId: string) {
    return this.records.get(`${assetKind}:${assetId}`) ?? null;
  }
  async save(record: ReviewClockRecord) {
    this.records.set(`${record.assetKind}:${record.assetId}`, record);
  }
  async listActive() {
    return [...this.records.values()].filter((r) => r.state === "active");
  }
  async listPendingReview() {
    return [...this.records.values()].filter((r) => r.state === "pending-review");
  }
}

class FakeGovernance implements AssetGovernanceRepository {
  constructor(private readonly records: Map<string, AssetGovernanceRecord> = new Map()) {}
  async get(assetKind: string, assetId: string) {
    return this.records.get(`${assetKind}:${assetId}`) ?? null;
  }
  async set(assetKind: string, assetId: string, governance: AssetGovernanceRecord) {
    this.records.set(`${assetKind}:${assetId}`, governance);
  }
}

class FakeOwnerStatus implements AssetOwnerStatusPort {
  constructor(private readonly deactivated: ReadonlySet<string>) {}
  async isOwnerDeactivated(ownerId: string) {
    return this.deactivated.has(ownerId);
  }
}

function downgradedClock(overrides: Partial<ReviewClockRecord> = {}): ReviewClockRecord {
  return {
    assetKind: "skill",
    assetId: "a1",
    state: "downgraded",
    publishedAt: "2025-01-01T00:00:00.000Z",
    reviewDueAt: "2026-01-01T00:00:00.000Z",
    downgradeDueAt: null,
    lastReviewedAt: null,
    lastReviewedBy: null,
    ...overrides,
  };
}

function governanceOf(overrides: Partial<AssetGovernanceRecord> = {}): AssetGovernanceRecord {
  return {
    visibility: "private-draft",
    teamIds: [],
    editableBy: ["u-owner"],
    ownerId: "u-owner",
    reviewCycle: "12m",
    ...overrides,
  };
}

describe("F140 -- uc-23-6 E1: 降级终态 + 负责人已停用 => 无主资产提示 + 接管入口", () => {
  it("降级 + 负责人账号已停用 => orphaned=true, code=ASSET_DOWNGRADED_OWNER_MISSING, takeoverEntryPoint=true", async () => {
    const reviewClocks = new FakeReviewClocks();
    const governance = new FakeGovernance();
    await reviewClocks.save(downgradedClock());
    await governance.set("skill", "a1", governanceOf());
    const ownerStatus = new FakeOwnerStatus(new Set(["u-owner"]));

    const result = await getAssetOrphanStatus(
      { reviewClocks, governance, ownerStatus },
      { assetKind: "skill", assetId: "a1" },
    );

    expect(result.orphaned).toBe(true);
    expect(result.code).toBe("ASSET_DOWNGRADED_OWNER_MISSING");
    expect(result.takeoverEntryPoint).toBe(true);
  });

  it("反证 ①：降级但负责人账号仍在 => 不是无主资产", async () => {
    const reviewClocks = new FakeReviewClocks();
    const governance = new FakeGovernance();
    await reviewClocks.save(downgradedClock());
    await governance.set("skill", "a1", governanceOf());
    const ownerStatus = new FakeOwnerStatus(new Set()); // 没有任何人被停用

    const result = await getAssetOrphanStatus(
      { reviewClocks, governance, ownerStatus },
      { assetKind: "skill", assetId: "a1" },
    );

    expect(result).toEqual({ orphaned: false, code: null, takeoverEntryPoint: false });
  });

  it("反证 ②：负责人账号已停用，但资产尚未降级（仍是 active/pending-review）=> 不报无主", async () => {
    const reviewClocks = new FakeReviewClocks();
    const governance = new FakeGovernance();
    await reviewClocks.save(downgradedClock({ state: "pending-review", downgradeDueAt: "2026-06-01T00:00:00.000Z" }));
    await governance.set("skill", "a1", governanceOf({ visibility: "specified-teams", teamIds: ["team-a"] }));
    const ownerStatus = new FakeOwnerStatus(new Set(["u-owner"]));

    const result = await getAssetOrphanStatus(
      { reviewClocks, governance, ownerStatus },
      { assetKind: "skill", assetId: "a1" },
    );

    expect(result).toEqual({ orphaned: false, code: null, takeoverEntryPoint: false });
  });

  it("反证 ③：从未发布过的资产（无时钟记录）=> 不报无主", async () => {
    const reviewClocks = new FakeReviewClocks();
    const governance = new FakeGovernance();
    const ownerStatus = new FakeOwnerStatus(new Set(["u-owner"]));

    const result = await getAssetOrphanStatus(
      { reviewClocks, governance, ownerStatus },
      { assetKind: "skill", assetId: "never-published" },
    );

    expect(result).toEqual({ orphaned: false, code: null, takeoverEntryPoint: false });
  });

  it("反证 ④：降级但没有治理记录（不该发生，见 scan-review-clocks.ts 同型注释）=> 跳过而非编造裁决", async () => {
    const reviewClocks = new FakeReviewClocks();
    const governance = new FakeGovernance();
    await reviewClocks.save(downgradedClock({ assetId: "no-governance" }));
    // 故意不写入 governance 记录
    const ownerStatus = new FakeOwnerStatus(new Set(["u-owner"]));

    const result = await getAssetOrphanStatus(
      { reviewClocks, governance, ownerStatus },
      { assetKind: "skill", assetId: "no-governance" },
    );

    expect(result).toEqual({ orphaned: false, code: null, takeoverEntryPoint: false });
  });
});
