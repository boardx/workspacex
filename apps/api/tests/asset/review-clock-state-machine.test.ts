/**
 * F138 -- `uc-23-6` R3 状态机（`active <-> pending-review`, T1 + T3）. Pure domain +
 * application-layer test, no Postgres (issue #74).
 *
 * Covers R12 验收线索 1（到期扫描转 `待复核`）与 7（复核 ⇒ 状态回生效、`reviewDueAt` 从复核时间
 * 重新起算、留一条复核记录）。The 30-day downgrade (T2) is explicitly NOT asserted here -- that
 * is F139's territory (see `domain/asset/asset-review-clock.ts`'s header, AG3/Q-7).
 */
import { describe, expect, it } from "vitest";
import {
  applyReview,
  isReviewDue,
  transitionToPendingReview,
  type ReviewClockRecord,
} from "../../src/domain/asset/asset-review-clock";
import { scanReviewClocks } from "../../src/application/asset/scan-review-clocks";
import { reviewAsset } from "../../src/application/asset/review-asset";
import type { AssetGovernanceRecord, AssetGovernanceRepository, ReviewClockRepository } from "../../src/application/asset/ports";
import type { OrgMembershipRow } from "../../src/application/identity/ports";
import { toOrgId } from "../../src/domain/org-id";

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

const orgId = toOrgId("org-1");
const member: OrgMembershipRow = { orgRole: "consultant", teamId: null };
const memberRepo = { findOrgMembership: async () => member };

function clockAt(overrides: Partial<ReviewClockRecord> = {}): ReviewClockRecord {
  return {
    assetKind: "skill",
    assetId: "a1",
    state: "active",
    publishedAt: "2026-01-01T00:00:00.000Z",
    reviewDueAt: "2026-07-01T00:00:00.000Z",
    downgradeDueAt: null,
    lastReviewedAt: null,
    lastReviewedBy: null,
    ...overrides,
  };
}

describe("domain: isReviewDue / transitionToPendingReview (T1)", () => {
  it("到期时间已过 + active -> 到期 (isReviewDue = true)", () => {
    expect(isReviewDue(clockAt(), "2026-08-01T00:00:00.000Z")).toBe(true);
  });

  it("尚未到期 -> 不到期", () => {
    expect(isReviewDue(clockAt(), "2026-06-01T00:00:00.000Z")).toBe(false);
  });

  it("已经是 pending-review 的记录再跑一次 T1 -> 不再触发（不是二次转态）", () => {
    const pending = clockAt({ state: "pending-review" });
    expect(isReviewDue(pending, "2026-08-01T00:00:00.000Z")).toBe(false);
    expect(transitionToPendingReview(pending, "2026-08-01T00:00:00.000Z")).toBe(pending);
  });

  it("已经是 downgraded 的记录不会被 T1 拉回 pending-review", () => {
    const downgraded = clockAt({ state: "downgraded" });
    expect(isReviewDue(downgraded, "2026-08-01T00:00:00.000Z")).toBe(false);
  });

  it("到期转态只改 state 与 downgradeDueAt（F139 起算 30 天窗口），publishedAt/reviewDueAt 原样保留", () => {
    const updated = transitionToPendingReview(clockAt(), "2026-08-01T00:00:00.000Z");
    expect(updated.state).toBe("pending-review");
    expect(updated.publishedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(updated.reviewDueAt).toBe("2026-07-01T00:00:00.000Z");
    // F139: downgradeDueAt is now populated at the moment of the T1 transition itself (30 days
    // from `nowIso`, not from `reviewDueAt`) -- see `asset-review-clock.ts`'s F139 header.
    expect(updated.downgradeDueAt).toBe("2026-08-31T00:00:00.000Z");
  });

  it("未到期时转态是 no-op（返回同一份记录）", () => {
    const record = clockAt();
    expect(transitionToPendingReview(record, "2026-06-01T00:00:00.000Z")).toBe(record);
  });
});

describe("domain: applyReview (T3 -- 复核 ⇒ 计时重置)", () => {
  it("复核后状态回生效，reviewDueAt 从复核时间起算（不是原 publishedAt）", () => {
    const pending = clockAt({ state: "pending-review" });
    const reviewed = applyReview(pending, "u-owner", "2026-08-15T00:00:00.000Z", "6m");
    expect(reviewed.state).toBe("active");
    expect(reviewed.reviewDueAt).toBe("2027-02-15T00:00:00.000Z");
    expect(reviewed.downgradeDueAt).toBeNull();
    expect(reviewed.lastReviewedAt).toBe("2026-08-15T00:00:00.000Z");
    expect(reviewed.lastReviewedBy).toBe("u-owner");
  });

  it("从 active 直接复核（到期前主动复核，A1）同样重置计时", () => {
    const active = clockAt();
    const reviewed = applyReview(active, "u-owner", "2026-03-01T00:00:00.000Z", "12m");
    expect(reviewed.state).toBe("active");
    expect(reviewed.reviewDueAt).toBe("2027-03-01T00:00:00.000Z");
  });
});

describe("application: ScanReviewClocks -- T1 主动扫描（R9 反证惰性判定）", () => {
  it("零调用的到期资产也会被扫描转态（没人读过它，扫描仍生效）", async () => {
    const repo = new InMemoryReviewClocks();
    await repo.save(clockAt({ assetId: "never-read" }));

    const result = await scanReviewClocks({ reviewClocks: repo, governance: new InMemoryGovernanceRepo() }, { now: "2026-08-01T00:00:00.000Z" });

    expect(result.transitionedToPending).toEqual([{ assetKind: "skill", assetId: "never-read" }]);
    expect(result.downgraded).toEqual([]); // F139's territory -- not this feature's scope
    expect(result.lastScanAt).toBe("2026-08-01T00:00:00.000Z");

    const after = await repo.get("skill", "never-read");
    expect(after?.state).toBe("pending-review");
  });

  it("未到期的资产不受影响", async () => {
    const repo = new InMemoryReviewClocks();
    await repo.save(clockAt({ assetId: "not-due", reviewDueAt: "2099-01-01T00:00:00.000Z" }));

    const result = await scanReviewClocks({ reviewClocks: repo, governance: new InMemoryGovernanceRepo() }, { now: "2026-08-01T00:00:00.000Z" });

    expect(result.transitionedToPending).toEqual([]);
    const after = await repo.get("skill", "not-due");
    expect(after?.state).toBe("active");
  });

  it("扫描时间戳始终可观测，即使没有任何转态发生", async () => {
    const repo = new InMemoryReviewClocks();
    const result = await scanReviewClocks({ reviewClocks: repo, governance: new InMemoryGovernanceRepo() }, { now: "2026-09-01T00:00:00.000Z" });
    expect(result.lastScanAt).toBe("2026-09-01T00:00:00.000Z");
  });
});

describe("application: ReviewAsset -- T3 端到端（org 成员 + editableBy 门 + 计时重置）", () => {
  async function seed(): Promise<{ governance: InMemoryGovernanceRepo; reviewClocks: InMemoryReviewClocks }> {
    const governance = new InMemoryGovernanceRepo();
    await governance.set("skill", "a1", {
      visibility: "specified-teams",
      teamIds: ["team-energy"],
      editableBy: ["u-owner"],
      ownerId: "u-owner",
      reviewCycle: "6m",
    });
    const reviewClocks = new InMemoryReviewClocks();
    await reviewClocks.save(clockAt({ state: "pending-review" }));
    return { governance, reviewClocks };
  }

  it("负责人复核 -> 状态回生效 + reviewDueAt 重置 + 返回一条复核记录", async () => {
    const { governance, reviewClocks } = await seed();
    const result = await reviewAsset(
      { repo: memberRepo, governance, reviewClocks, clock: { now: () => new Date("2026-08-20T00:00:00.000Z") } },
      { userId: "u-owner", orgId, assetKind: "skill", assetId: "a1", conclusion: "看过了，继续用" },
    );

    expect(result.clock.state).toBe("active");
    expect(result.clock.reviewDueAt).toBe("2027-02-20T00:00:00.000Z");
    expect(result.clock.lastReviewedBy).toBe("u-owner");
    expect(result.clock.lastReviewedAt).toBe("2026-08-20T00:00:00.000Z");
  });

  it("不在 editableBy / 不是负责人 -> ASSET_NOT_EDITABLE，计时不被重置", async () => {
    const { governance, reviewClocks } = await seed();
    await expect(
      reviewAsset(
        { repo: memberRepo, governance, reviewClocks, clock: { now: () => new Date("2026-08-20T00:00:00.000Z") } },
        { userId: "u-stranger", orgId, assetKind: "skill", assetId: "a1", conclusion: "x" },
      ),
    ).rejects.toMatchObject({ code: "ASSET_NOT_EDITABLE" });

    const untouched = await reviewClocks.get("skill", "a1");
    expect(untouched?.state).toBe("pending-review");
  });

  it("`conclusion` 是开放字符串，取值不做任何校验/分支（AG2）", async () => {
    const { governance, reviewClocks } = await seed();
    const result = await reviewAsset(
      { repo: memberRepo, governance, reviewClocks, clock: { now: () => new Date("2026-08-20T00:00:00.000Z") } },
      { userId: "u-owner", orgId, assetKind: "skill", assetId: "a1", conclusion: "随便写点什么都行" },
    );
    expect(result.clock.state).toBe("active");
  });
});
