/**
 * F143 -- `DeleteAssetFile` / `RenameAssetFile`'s root-file gate (`uc-23-3` R7 rule 3 / R12-9,
 * domain I-7).
 *
 * Pure application-layer test, no Postgres (issue #74).
 *
 * ⚠ **Root-file protection binds EVEN THE OWNER**, not just outsiders -- these tests call
 * `deleteAssetFile` / `renameAssetFile` as the asset's own maintainer and still expect
 * `ROOT_FILE_UNDELETABLE`, proving the rule is not merely a UI affordance that a
 * permission-gated user could bypass by calling the API directly (same discipline as
 * `asset-not-editable-readonly.test.ts`).
 * ⚠ **Renaming the root file is asserted to be the SAME error as deleting it** -- the
 * contract's own note: "改根文件名等价于删根文件".
 */
import { describe, expect, it } from "vitest";
import { toOrgId } from "../../src/domain/org-id";
import type { OrgMembershipRow } from "../../src/application/identity/ports";
import { FixtureAssetFileRepository } from "../../src/infrastructure/asset/fixture-asset-file-repository";
import { InMemoryAssetGovernanceRepository } from "../../src/infrastructure/asset/in-memory-asset-governance-repository";
import { readAssetFile } from "../../src/application/asset/read-asset-file";
import { AssetNotFoundError } from "../../src/application/asset/get-asset-directory";
import { deleteAssetFile, RootFileUndeletableError } from "../../src/application/asset/delete-asset-file";
import { renameAssetFile } from "../../src/application/asset/rename-asset-file";
import { AssetNotEditableError } from "../../src/application/asset/set-asset-governance";
import type { AssetGovernanceRecord, AssetGovernanceRepository } from "../../src/application/asset/ports";

const orgId = toOrgId("org-1");
const member: OrgMembershipRow = { orgRole: "consultant", teamId: null };
const memberRepo = { findOrgMembership: async () => member };

const GOVERNED: AssetGovernanceRecord = {
  visibility: "specified-teams",
  teamIds: ["team-energy"],
  editableBy: ["u-maintainer"],
  ownerId: "u-owner",
  reviewCycle: "12m",
};

async function governedRepo(): Promise<AssetGovernanceRepository> {
  const repo = new InMemoryAssetGovernanceRepository();
  await repo.set("skill", "sk-1", GOVERNED);
  await repo.set("agent", "ag-1", GOVERNED);
  return repo;
}

describe("DeleteAssetFile / RenameAssetFile -- 根文件不可删/改名 (I-7)，即使是负责人本人", () => {
  it("负责人本人删除 SKILL.md -> ROOT_FILE_UNDELETABLE，不是权限问题", async () => {
    const deps = { repo: memberRepo, assets: new FixtureAssetFileRepository(), governance: await governedRepo() };
    await expect(
      deleteAssetFile(deps, { userId: "u-owner", orgId, assetKind: "skill", assetId: "sk-1", path: "SKILL.md" }),
    ).rejects.toBeInstanceOf(RootFileUndeletableError);
  });

  it("editableBy 内的维护者删除 AGENT.md -> 同样 ROOT_FILE_UNDELETABLE", async () => {
    const deps = { repo: memberRepo, assets: new FixtureAssetFileRepository(), governance: await governedRepo() };
    await expect(
      deleteAssetFile(deps, { userId: "u-maintainer", orgId, assetKind: "agent", assetId: "ag-1", path: "AGENT.md" }),
    ).rejects.toBeInstanceOf(RootFileUndeletableError);
  });

  it("非根文件可以正常删除", async () => {
    const deps = { repo: memberRepo, assets: new FixtureAssetFileRepository(), governance: await governedRepo() };
    const result = await deleteAssetFile(deps, {
      userId: "u-owner",
      orgId,
      assetKind: "skill",
      assetId: "sk-1",
      path: "references/output-schema.md",
    });
    expect(result.deleted).toBe("references/output-schema.md");

    // 删除后再读 -> AssetNotFoundError（不是 IO 错误，是同一个「不存在」出口）。
    await expect(
      readAssetFile(deps, { userId: "u-owner", orgId, assetKind: "skill", assetId: "sk-1", path: "references/output-schema.md" }),
    ).rejects.toBeInstanceOf(AssetNotFoundError);
  });

  it("改 SKILL.md 的名字（rename from=SKILL.md）-> 等价于删根文件，同样 ROOT_FILE_UNDELETABLE", async () => {
    const deps = { repo: memberRepo, assets: new FixtureAssetFileRepository(), governance: await governedRepo() };
    await expect(
      renameAssetFile(deps, {
        userId: "u-owner",
        orgId,
        assetKind: "skill",
        assetId: "sk-1",
        from: "SKILL.md",
        to: "SKILL_v2.md",
      }),
    ).rejects.toBeInstanceOf(RootFileUndeletableError);
  });

  it("非根文件可以正常改名，内容随之可从新路径读到", async () => {
    const deps = { repo: memberRepo, assets: new FixtureAssetFileRepository(), governance: await governedRepo() };
    const result = await renameAssetFile(deps, {
      userId: "u-owner",
      orgId,
      assetKind: "skill",
      assetId: "sk-1",
      from: "references/output-schema.md",
      to: "references/output-schema-v2.md",
    });
    expect(result.file.path).toBe("references/output-schema-v2.md");
    expect(result.file.isRoot).toBe(false);

    const read = await readAssetFile(deps, {
      userId: "u-owner",
      orgId,
      assetKind: "skill",
      assetId: "sk-1",
      path: "references/output-schema-v2.md",
    });
    expect(typeof read.body).toBe("string");

    await expect(
      readAssetFile(deps, { userId: "u-owner", orgId, assetKind: "skill", assetId: "sk-1", path: "references/output-schema.md" }),
    ).rejects.toBeInstanceOf(AssetNotFoundError);
  });

  it("不在 editableBy 内、也不是 owner -> 先判 ASSET_NOT_EDITABLE，不需要触达根文件判断即可拒绝非根文件删除", async () => {
    const deps = { repo: memberRepo, assets: new FixtureAssetFileRepository(), governance: await governedRepo() };
    await expect(
      deleteAssetFile(deps, {
        userId: "u-random-member",
        orgId,
        assetKind: "skill",
        assetId: "sk-1",
        path: "references/output-schema.md",
      }),
    ).rejects.toBeInstanceOf(AssetNotEditableError);
  });
});
