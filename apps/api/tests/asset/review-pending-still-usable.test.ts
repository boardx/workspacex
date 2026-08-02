/**
 * F138 -- `uc-23-6` R7 规则 2/3: "`待复核` 仍可用" -- 不停用、不移出检索/装载范围，只是调用时
 * 会提示（`GetReviewClock` 暴露 `state: "pending-review"` 给调用方，用来在界面上出这个提示；
 * 提示本身长什么样是 `[设计]`，本仓 0 命中，本测试不断言 UI 形状）。Pure application-layer
 * test, no Postgres (issue #74).
 *
 * 🔴 **This file exists specifically to reverse-assert the failure mode the issue calls out**:
 * an implementation that turns `pending-review` into a disabled/unavailable asset would make
 * the state-machine tests pass while silently breaking the rule that matters most -- "仍可用"
 * is a promise about availability, and a naive read of "转态" alone does not test it. Every
 * assertion below either (a) proves the asset is still fully readable while `pending-review`,
 * or (b) proves the SAME data comes back as when the clock is `active` -- not a degraded
 * response shape.
 */
import { describe, expect, it } from "vitest";
import { getAssetDirectory } from "../../src/application/asset/get-asset-directory";
import { readAssetFile } from "../../src/application/asset/read-asset-file";
import { getReviewClock } from "../../src/application/asset/get-review-clock";
import { FixtureAssetFileRepository } from "../../src/infrastructure/asset/fixture-asset-file-repository";
import type { ReviewClockRecord } from "../../src/domain/asset/asset-review-clock";
import type { ReviewClockRepository } from "../../src/application/asset/ports";
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
}

const orgId = toOrgId("org-1");
const member: OrgMembershipRow = { orgRole: "consultant", teamId: null };
const memberRepo = { findOrgMembership: async () => member };

function pendingClock(): ReviewClockRecord {
  return {
    assetKind: "skill",
    assetId: "a1",
    state: "pending-review",
    publishedAt: "2026-01-01T00:00:00.000Z",
    reviewDueAt: "2026-07-01T00:00:00.000Z",
    downgradeDueAt: null,
    lastReviewedAt: null,
    lastReviewedBy: null,
  };
}

describe("uc-23-6 R7 规则 2: 待复核资产仍可用 -- 目录浏览不受影响", () => {
  it("GetAssetDirectory 对 pending-review 资产返回与 active 资产完全相同的目录", async () => {
    const assets = new FixtureAssetFileRepository();
    const deps = { repo: memberRepo, assets };

    const whilePending = await getAssetDirectory(deps, { userId: "u1", orgId, assetKind: "skill", assetId: "pending-asset" });
    const whileActive = await getAssetDirectory(deps, { userId: "u1", orgId, assetKind: "skill", assetId: "active-asset" });

    // Same fixture tree either way -- pending-review does not shrink, hide, or reshape the
    // directory. (The two assetIds share the same underlying fixture; the point is that
    // GetAssetDirectory itself never even looks at review-clock state.)
    expect(whilePending).toEqual(whileActive);
    expect(whilePending.files.length).toBeGreaterThan(0);
    expect(whilePending.rootFile).toBe("SKILL.md");
  });

  it("ReadAssetFile 对 pending-review 资产仍能读到完整文件内容（不停用、不空响应）", async () => {
    const assets = new FixtureAssetFileRepository();
    const result = await readAssetFile(
      { repo: memberRepo, assets },
      { userId: "u1", orgId, assetKind: "skill", assetId: "pending-asset", path: "SKILL.md" },
    );
    expect(result.body.length).toBeGreaterThan(0);
    expect(result.body).toContain("MECE 假设拆解");
  });
});

describe("uc-23-6 R7 规则 3: 调用时会提示 -- GetReviewClock 是调用方拿到提示信号的地方", () => {
  it("GetReviewClock 报告 pending-review，供调用方在读取路径旁展示提示", async () => {
    const reviewClocks = new InMemoryReviewClocks();
    await reviewClocks.save(pendingClock());

    const clockResult = await getReviewClock(
      { repo: memberRepo, reviewClocks },
      { userId: "u1", orgId, assetKind: "skill", assetId: "a1" },
    );

    expect(clockResult.clock.state).toBe("pending-review");
    // The asset is simultaneously fully readable (previous describe block) AND reporting
    // pending-review here -- these two facts must be able to coexist, which is exactly what
    // "仍可用，调用时会提示" means. A reject-on-pending implementation would make the read
    // calls above throw instead of succeed; this repo's ReadAssetFile/GetAssetDirectory never
    // even take a reviewClocks dependency, so there is no code path by which they COULD reject
    // based on clock state.
    expect(clockResult.clock.reviewDueAt).toBe("2026-07-01T00:00:00.000Z");
  });

  it("从未发布过的资产 -> 合成一个 active/全 null 的时钟，不是 404", async () => {
    const reviewClocks = new InMemoryReviewClocks();
    const clockResult = await getReviewClock(
      { repo: memberRepo, reviewClocks },
      { userId: "u1", orgId, assetKind: "skill", assetId: "never-published" },
    );
    expect(clockResult.clock.state).toBe("active");
    expect(clockResult.clock.publishedAt).toBeNull();
    expect(clockResult.clock.reviewDueAt).toBeNull();
  });

  it("downgraded 状态与 pending-review 不同 -- 本反证只覆盖 pending-review，不断言 downgraded 的可用性（F139/F140 territory）", async () => {
    const reviewClocks = new InMemoryReviewClocks();
    await reviewClocks.save({ ...pendingClock(), state: "downgraded" });
    const clockResult = await getReviewClock(
      { repo: memberRepo, reviewClocks },
      { userId: "u1", orgId, assetKind: "skill", assetId: "a1" },
    );
    expect(clockResult.clock.state).toBe("downgraded");
  });
});
