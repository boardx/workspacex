/**
 * F135 -- `uc-23-4` R3 第一项 / R7 rule 1, domain I-14. Pure application-layer test, no
 * Postgres (issue #74).
 *
 * Two independent assertions, each with its own counter-proof:
 *
 *   ① `visibility: "whole-org"` -> `requiresCosign: true`. The wrong version of this feature
 *      quietly treats "全组织" as immediately effective (a plausible reading of "保存成功了"),
 *      which is exactly the gap `uc-23-4` A1 calls out: the domain 负责人 联签 flow is
 *      `[待确认]`, so the response must say "not yet" rather than pretend the save alone
 *      granted org-wide visibility.
 *   ② `visibility: "specified-teams"` with an EMPTY `teamIds` cannot be saved -- this is the
 *      same `GOVERNANCE_INCOMPLETE` fold already covered by `governance-incomplete-four-fields
 *      .test.ts`'s "第五个字段" case, re-asserted here because it is this feature's own
 *      acceptance line ("选空了保存不了"), not merely a side effect of F134's test.
 *
 * Counter-proof for ①: `"specified-teams"` and `"private-draft"` must both come back with
 * `requiresCosign: false` -- an implementation that always returns `true` (or always `false`)
 * would pass a test that only tries `"whole-org"`.
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

function draft(overrides: Partial<AssetGovernanceDraft>): AssetGovernanceDraft {
  return {
    visibility: "specified-teams",
    teamIds: ["team-energy"],
    editableBy: ["u-owner"],
    ownerId: "u-owner",
    reviewCycle: "12m",
    ...overrides,
  };
}

describe("① 全组织 -> requiresCosign: true，且不是「保存即生效」", () => {
  it("visibility: whole-org 返回 requiresCosign: true", async () => {
    const deps = { repo: memberRepo, governance: new InMemoryGovernanceRepo() };
    const result = await setAssetGovernance(deps, {
      userId: "u-owner",
      orgId,
      assetKind: "skill",
      assetId: "a1",
      draft: draft({ visibility: "whole-org", teamIds: [] }),
    });
    expect(result.governance.visibility).toBe("whole-org");
    expect(result.requiresCosign).toBe(true);
  });

  it("反证：specified-teams 与 private-draft 都不需要联签（不是恒真 true）", async () => {
    const deps1 = { repo: memberRepo, governance: new InMemoryGovernanceRepo() };
    const specifiedTeams = await setAssetGovernance(deps1, {
      userId: "u-owner",
      orgId,
      assetKind: "skill",
      assetId: "a1",
      draft: draft({ visibility: "specified-teams", teamIds: ["team-energy"] }),
    });
    expect(specifiedTeams.requiresCosign).toBe(false);

    const deps2 = { repo: memberRepo, governance: new InMemoryGovernanceRepo() };
    const privateDraft = await setAssetGovernance(deps2, {
      userId: "u-owner",
      orgId,
      assetKind: "skill",
      assetId: "a1",
      draft: draft({ visibility: "private-draft", teamIds: [] }),
    });
    expect(privateDraft.requiresCosign).toBe(false);
  });

  it("本层不发明联签审批流：SetAssetGovernance 的输出形状里没有第二个「联签状态」字段", async () => {
    const deps = { repo: memberRepo, governance: new InMemoryGovernanceRepo() };
    const result = await setAssetGovernance(deps, {
      userId: "u-owner",
      orgId,
      assetKind: "skill",
      assetId: "a1",
      draft: draft({ visibility: "whole-org", teamIds: [] }),
    });
    // Only `requiresCosign` -- no invented `cosignStatus` / `approvalState` / `pendingCosignBy`.
    expect(Object.keys(result).sort()).toEqual(["governance", "requiresCosign"]);
  });
});

describe("② 指定团队但一个团队都没选 -> 保存不了（折算为 visibility 缺失）", () => {
  it("teamIds 为空 -> GOVERNANCE_INCOMPLETE，报 visibility", async () => {
    const deps = { repo: memberRepo, governance: new InMemoryGovernanceRepo() };
    await expect(
      setAssetGovernance(deps, {
        userId: "u-owner",
        orgId,
        assetKind: "skill",
        assetId: "a1",
        draft: draft({ visibility: "specified-teams", teamIds: [] }),
      }),
    ).rejects.toSatisfy((e: unknown) => {
      expect(e).toBeInstanceOf(GovernanceIncompleteError);
      expect((e as GovernanceIncompleteError).missingFields).toEqual(["visibility"]);
      return true;
    });
  });

  it("反证：拒绝时不写入仓库 -- 不是「先存一个空数组再报错」", async () => {
    const governance = new InMemoryGovernanceRepo();
    const deps = { repo: memberRepo, governance };
    await expect(
      setAssetGovernance(deps, {
        userId: "u-owner",
        orgId,
        assetKind: "skill",
        assetId: "a1",
        draft: draft({ visibility: "specified-teams", teamIds: [] }),
      }),
    ).rejects.toBeInstanceOf(GovernanceIncompleteError);
    expect(await governance.get("skill", "a1")).toBeNull();
  });

  it("至少选一个团队 -> 正常保存", async () => {
    const deps = { repo: memberRepo, governance: new InMemoryGovernanceRepo() };
    const result = await setAssetGovernance(deps, {
      userId: "u-owner",
      orgId,
      assetKind: "skill",
      assetId: "a1",
      draft: draft({ visibility: "specified-teams", teamIds: ["team-energy"] }),
    });
    expect(result.governance.teamIds).toEqual(["team-energy"]);
  });
});
