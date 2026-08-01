/**
 * F134 -- `uc-23-4` R3, domain I-10 / I-11. Pure application-layer test, no Postgres (issue #74):
 * uses an in-memory `AssetGovernanceRepository` and a fake `IdentityRepository`.
 *
 * 🔴 **Six kinds, each run separately.** "六种资产完全一样" (`[原型 @16.611M]`) is only checkable
 * by asserting it for all six `AssetKind` values individually -- picking one and asserting a
 * general claim would let a kind-specific branch slip through undetected (this bundle's own
 * domain.md, on why `AssetKind` assertions must be per-member, not `toHaveLength`-style).
 */
import { describe, expect, it } from "vitest";
import { AssetKind } from "@repo/contracts/asset-governance";
import { getAssetGovernance } from "../../src/application/asset/get-asset-governance";
import { setAssetGovernance } from "../../src/application/asset/set-asset-governance";
import type { AssetGovernanceRecord, AssetGovernanceRepository } from "../../src/application/asset/ports";
import type { OrgMembershipRow } from "../../src/application/identity/ports";
import { toOrgId } from "../../src/domain/org-id";

const ALL_SIX_ASSET_KINDS = AssetKind.options;

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

describe("AssetGovernance -- 六种资产完全一样 (I-10 / I-11)", () => {
  it("恰六个 AssetKind 取值（成员集合相等，非 toHaveLength）", () => {
    expect(new Set(ALL_SIX_ASSET_KINDS)).toEqual(
      new Set(["agent", "skill", "model", "mcp", "canvas-template", "blueprint"]),
    );
  });

  for (const kind of ALL_SIX_ASSET_KINDS) {
    it(`${kind}: 设置四项完整治理配置后，读回的字段与取值集合与其它五类完全相同`, async () => {
      const governance = new InMemoryGovernanceRepo();
      const deps = { repo: memberRepo, governance };

      const setResult = await setAssetGovernance(deps, {
        userId: "u-owner",
        orgId,
        assetKind: kind,
        assetId: `${kind}-asset-1`,
        draft: {
          visibility: "specified-teams",
          teamIds: ["team-energy", "team-platform"],
          editableBy: ["u-owner", "role:platform-admin"],
          ownerId: "u-owner",
          reviewCycle: "24m",
        },
      });

      expect(Object.keys(setResult.governance).sort()).toEqual(
        ["editableBy", "ownerId", "reviewCycle", "teamIds", "visibility"].sort(),
      );
      expect(setResult.governance.reviewCycle).toBe("24m");
      expect(setResult.requiresCosign).toBe(false);

      const getResult = await getAssetGovernance(deps, {
        userId: "u-owner",
        orgId,
        assetKind: kind,
        assetId: `${kind}-asset-1`,
      });
      expect(getResult.governance).toEqual(setResult.governance);
    });
  }

  it("每个字段的取值集合恰为契约定义的封闭枚举，六类共用同一套（不为某一类另开一套）", async () => {
    const reviewCycles: readonly string[] = ["6m", "12m", "24m"];
    const visibilities: readonly string[] = ["specified-teams", "whole-org", "private-draft"];

    for (const kind of ALL_SIX_ASSET_KINDS) {
      const governance = new InMemoryGovernanceRepo();
      const deps = { repo: memberRepo, governance };
      for (const reviewCycle of reviewCycles) {
        for (const visibility of visibilities) {
          const result = await setAssetGovernance(deps, {
            userId: "u-owner",
            orgId,
            assetKind: kind,
            assetId: `${kind}-asset-2`,
            draft: {
              visibility: visibility as "specified-teams" | "whole-org" | "private-draft",
              teamIds: visibility === "specified-teams" ? ["team-a"] : [],
              editableBy: ["u-owner"],
              ownerId: "u-owner",
              reviewCycle: reviewCycle as "6m" | "12m" | "24m",
            },
          });
          expect(result.governance.reviewCycle).toBe(reviewCycle);
          expect(result.governance.visibility).toBe(visibility);
          expect(result.requiresCosign).toBe(visibility === "whole-org");
        }
      }
    }
  });

  it("尚未配置过治理的资产：getAssetGovernance 返回 null，不是一份默认值", async () => {
    const governance = new InMemoryGovernanceRepo();
    const deps = { repo: memberRepo, governance };
    for (const kind of ALL_SIX_ASSET_KINDS) {
      const result = await getAssetGovernance(deps, {
        userId: "u-owner",
        orgId,
        assetKind: kind,
        assetId: "never-configured",
      });
      expect(result.governance).toBeNull();
    }
  });
});
