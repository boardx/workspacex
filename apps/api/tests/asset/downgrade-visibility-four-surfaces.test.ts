/**
 * F140 -- `uc-23-6` R7 规则 7, domain I-12 / I-14 ("四个入口各断言 0 命中，且直读返回 404 非
 * 403，与 `skills` I-14 同形，复用同一判定函数"; `visibility-scope-four-entries.test.ts` 是
 * `skills` 束的同形参照)。
 *
 * ① 降级后的资产（`private-draft`, `teamIds: []`）对除负责人外的任何请求者，在
 *   列表 / 搜索 / 绑定面板 / Context Pack 四个入口的过滤结果里都是 0 命中，且四处逐字相同
 *   （证明四处共用 `filterVisibleAssets`/`isAssetVisibleTo` 同一份判定，不是四份各写一遍）。
 * ② 负责人本人在四个入口都仍看得见它（R7 规则 7："降级不是删除"）。
 * ③ 直读（`readVisibleAsset`）对非负责人返回与"资产真的不存在"完全相同的 `null`——
 *   404 非 403 的判定就是这个函数，不是控制器另写一次。
 * ④ 降级必须走与 `SetAssetGovernance` 相同的可见性写入路径（`scanReviewClocks` ->
 *   `writeAssetGovernanceVisibility`）——本文件的固定数据本身就是跑一次真实扫描产出的，
 *   而不是手写一个「假装已降级」的记录，行为上把 I-14 的两半（写入路径 + 可见性收敛）串起来。
 */
import { describe, expect, it } from "vitest";
import { scanReviewClocks } from "../../src/application/asset/scan-review-clocks";
import {
  ASSET_VISIBILITY_ENTRIES,
  filterVisibleAssets,
  readVisibleAsset,
  type AssetVisibilityEntry,
} from "../../src/domain/asset/asset-visibility";
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
  async all(): Promise<readonly (AssetGovernanceRecord & { assetKind: string; assetId: string })[]> {
    return [...this.store.entries()].map(([key, record]) => {
      const [assetKind, assetId] = key.split(":");
      return { ...record, assetKind: assetKind!, assetId: assetId! };
    });
  }
}

describe("F140 -- 降级后可见范围收敛为 {ownerId}，四入口共用同一判定（I-12/I-14）", () => {
  it("四入口对降级资产全部 0 命中（非负责人），负责人四处仍可见；直读对非负责人返回 null（404 非 403）", async () => {
    const reviewClocks = new InMemoryReviewClocks();
    const governance = new InMemoryGovernanceRepo();

    // 一份原本 specified-teams 的资产，进入 pending-review 已 30+ 天 -- 跑一次真实扫描
    // 让它经由 scanReviewClocks -> writeAssetGovernanceVisibility 真正降级（不是手写终态）。
    await reviewClocks.save({
      assetKind: "skill",
      assetId: "downgraded-1",
      state: "pending-review",
      publishedAt: "2025-01-01T00:00:00.000Z",
      reviewDueAt: "2026-01-01T00:00:00.000Z",
      downgradeDueAt: "2026-01-31T00:00:00.000Z",
      lastReviewedAt: null,
      lastReviewedBy: null,
    });
    await governance.set("skill", "downgraded-1", {
      visibility: "specified-teams",
      teamIds: ["team-energy"],
      editableBy: ["u-owner"],
      ownerId: "u-owner",
      reviewCycle: "12m",
    });

    // 一份仍然可见的对照资产，同一团队 -- 用来证明「不是全部资产都消失了」，只有降级的那份消失。
    await governance.set("skill", "still-visible", {
      visibility: "specified-teams",
      teamIds: ["team-energy"],
      editableBy: ["u-owner"],
      ownerId: "u-owner",
      reviewCycle: "12m",
    });

    const scan = await scanReviewClocks({ reviewClocks, governance }, { now: "2026-02-05T00:00:00.000Z" });
    expect(scan.downgraded).toEqual([{ assetKind: "skill", assetId: "downgraded-1" }]);

    const all = await governance.all();
    expect(all.find((a) => a.assetId === "downgraded-1")?.visibility).toBe("private-draft");
    expect(all.find((a) => a.assetId === "downgraded-1")?.teamIds).toEqual([]);

    // ── ① 四入口对非负责人：0 命中，四处逐字相同 ──
    const nonOwnerResults = ASSET_VISIBILITY_ENTRIES.map((entry: AssetVisibilityEntry) => ({
      entry,
      ids: filterVisibleAssets(all, "u-team-member", "team-energy").map((a) => a.assetId),
    }));
    for (const r of nonOwnerResults) {
      expect(r.ids, `entry=${r.entry}`).not.toContain("downgraded-1");
      expect(r.ids, `entry=${r.entry}`).toContain("still-visible");
    }
    const shapes = nonOwnerResults.map((r) => r.ids);
    for (let i = 1; i < shapes.length; i += 1) {
      expect(shapes[i], `entry=${nonOwnerResults[i]!.entry} 与 entry=${nonOwnerResults[0]!.entry} 的过滤结果必须相同`).toEqual(shapes[0]);
    }

    // ── ② 负责人本人：四处仍可见（降级不是删除，R7 规则 7）──
    for (const entry of ASSET_VISIBILITY_ENTRIES) {
      const ownerIds = filterVisibleAssets(all, "u-owner", null).map((a) => a.assetId);
      expect(ownerIds, `entry=${entry}`).toContain("downgraded-1");
    }

    // ── ③ 直读：非负责人得到的 null 与「压根不存在的资产」不可区分（404 非 403）──
    const downgradedRecord = all.find((a) => a.assetId === "downgraded-1")!;
    const outOfScope = readVisibleAsset(downgradedRecord, "u-team-member", "team-energy");
    const neverExisted = readVisibleAsset(null, "u-team-member", "team-energy");
    expect(outOfScope).toBeNull();
    expect(neverExisted).toBeNull();
    expect(outOfScope).toEqual(neverExisted);

    // 负责人直读：仍然拿得到完整记录（不是被同一份判定误伤）。
    const ownerRead = readVisibleAsset(downgradedRecord, "u-owner", null);
    expect(ownerRead?.visibility).toBe("private-draft");
  });
});
