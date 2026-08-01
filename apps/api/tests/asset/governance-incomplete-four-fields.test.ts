/**
 * F134 -- `uc-23-4` R3, domain I-10. Pure application-layer test, no Postgres (issue #74).
 *
 * ⚠ **Each of the four fields is emptied out ONE AT A TIME.** Testing only the "everything
 * empty" case would pass an implementation that only detects total emptiness and misses e.g.
 * "only the owner is missing" -- exactly the gap the feature's own notes warn about
 * ("只测「全空」的实现会漏掉「只缺负责人」").
 */
import { describe, expect, it } from "vitest";
import { setAssetGovernance, GovernanceIncompleteError } from "../../src/application/asset/set-asset-governance";
import type { AssetGovernanceDraft } from "../../src/domain/asset/asset-governance";
import type { AssetGovernanceRecord, AssetGovernanceRepository } from "../../src/application/asset/ports";
import type { OrgMembershipRow } from "../../src/application/identity/ports";
import { toOrgId } from "../../src/domain/org-id";

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

const COMPLETE: AssetGovernanceDraft = {
  visibility: "specified-teams",
  teamIds: ["team-energy"],
  editableBy: ["u-owner"],
  ownerId: "u-owner",
  reviewCycle: "12m",
};

async function expectIncomplete(draft: AssetGovernanceDraft, expectedMissing: readonly string[]) {
  const deps = { repo: memberRepo, governance: new InMemoryGovernanceRepo() };
  await expect(
    setAssetGovernance(deps, { userId: "u-owner", orgId, assetKind: "skill", assetId: "a1", draft }),
  ).rejects.toSatisfy((e: unknown) => {
    expect(e).toBeInstanceOf(GovernanceIncompleteError);
    expect((e as GovernanceIncompleteError).missingFields).toEqual(expectedMissing);
    return true;
  });
}

describe("SetAssetGovernance -- 四个字段各造一次缺失 (I-10)", () => {
  it("完整四项 -> 通过（对照组，证明其它三个用例是「缺了才拒」而非恒拒）", async () => {
    const deps = { repo: memberRepo, governance: new InMemoryGovernanceRepo() };
    const result = await setAssetGovernance(deps, {
      userId: "u-owner",
      orgId,
      assetKind: "skill",
      assetId: "a1",
      draft: COMPLETE,
    });
    expect(result.governance.ownerId).toBe("u-owner");
  });

  it("只缺 visibility -> 明确报 visibility，不是笼统的「配置不完整」", async () => {
    const { visibility: _drop, ...rest } = COMPLETE;
    await expectIncomplete(rest, ["visibility"]);
  });

  it("只缺 editableBy（空集合）-> 明确报 editableBy", async () => {
    await expectIncomplete({ ...COMPLETE, editableBy: [] }, ["editableBy"]);
  });

  it("只缺 ownerId（空字符串）-> 明确报 ownerId", async () => {
    await expectIncomplete({ ...COMPLETE, ownerId: "" }, ["ownerId"]);
  });

  it("只缺 reviewCycle -> 明确报 reviewCycle", async () => {
    const { reviewCycle: _drop, ...rest } = COMPLETE;
    await expectIncomplete(rest, ["reviewCycle"]);
  });

  it("visibility=specified-teams 但 teamIds 为空 -> 折算为 visibility 缺失，不是第五个字段名", async () => {
    await expectIncomplete({ ...COMPLETE, teamIds: [] }, ["visibility"]);
  });

  it("全部四项皆缺 -> 四个字段名全部列出（而不仅是第一个）", async () => {
    await expectIncomplete({}, ["visibility", "editableBy", "ownerId", "reviewCycle"]);
  });

  it("发布前拦截：任一次不完整的配置都不会写入仓库（缺一项就整体拒绝，不是部分保存）", async () => {
    const governance = new InMemoryGovernanceRepo();
    const deps = { repo: memberRepo, governance };
    const { ownerId: _drop, ...rest } = COMPLETE;
    await expect(
      setAssetGovernance(deps, { userId: "u-owner", orgId, assetKind: "skill", assetId: "a1", draft: rest }),
    ).rejects.toBeInstanceOf(GovernanceIncompleteError);
    expect(await governance.get("skill", "a1")).toBeNull();
  });
});
