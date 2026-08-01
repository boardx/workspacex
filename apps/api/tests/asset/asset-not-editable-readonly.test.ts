/**
 * F142 -- `WriteAssetFile`'s `editableBy` gate (`uc-23-3` E7, R5, R12-13).
 *
 * Pure application-layer test, no Postgres (issue #74).
 *
 * 🔴 **The whole point of this feature is that "只读" is enforced server-side.** These tests
 * call `writeAssetFile` directly -- the same function the controller calls -- with NO regard
 * for whatever button the UI would or would not have rendered. If this gate only lived in a
 * React component, none of these tests would fail, which is exactly the bug this feature
 * exists to close (issue #254's own wording: "就算绕过界面直接调接口也一样被拒").
 *
 * ⚠ Read access is untouched: a caller outside `editableBy` can still `readAssetFile` --
 * `uc-23-3` R5 draws a line between "not in the editable set" (read-only) and "outside the
 * visible scope entirely" (bare 404, `uc-23-3` R5's third bullet / `read-asset-file.ts`'s own
 * header). This suite only asserts the write side; the read side already has its own coverage.
 */
import { describe, expect, it } from "vitest";
import { toOrgId } from "../../src/domain/org-id";
import type { OrgMembershipRow } from "../../src/application/identity/ports";
import { FixtureAssetFileRepository } from "../../src/infrastructure/asset/fixture-asset-file-repository";
import { InMemoryAssetGovernanceRepository } from "../../src/infrastructure/asset/in-memory-asset-governance-repository";
import { readAssetFile } from "../../src/application/asset/read-asset-file";
import { AssetOrgScopeDeniedError } from "../../src/application/asset/get-asset-directory";
import { AssetNotEditableError } from "../../src/application/asset/set-asset-governance";
import { writeAssetFile } from "../../src/application/asset/write-asset-file";
import type { AssetGovernanceRecord, AssetGovernanceRepository } from "../../src/application/asset/ports";

const orgId = toOrgId("org-1");
const member: OrgMembershipRow = { orgRole: "consultant", teamId: null };
const memberRepo = { findOrgMembership: async (userId: string) => (userId === "u-outsider" ? null : member) };

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
  return repo;
}

describe("WriteAssetFile -- 不在「谁能改它」集合内 -> ASSET_NOT_EDITABLE，服务端强制 (E7)", () => {
  it("不在 editableBy、也不是 owner 的账号 -> 写被拒，即使直接调用用例函数（不经界面）", async () => {
    const deps = { repo: memberRepo, assets: new FixtureAssetFileRepository(), governance: await governedRepo() };
    await expect(
      writeAssetFile(deps, {
        userId: "u-random-member",
        orgId,
        assetKind: "skill",
        assetId: "sk-1",
        path: "SKILL.md",
        body: "---\nname: x\ndescription: y\nallowed-tools: Read\n---\n",
      }),
    ).rejects.toBeInstanceOf(AssetNotEditableError);
  });

  it("同一个不在集合内的账号仍然可以读（只读态，不是不可见）", async () => {
    const deps = { repo: memberRepo, assets: new FixtureAssetFileRepository(), governance: await governedRepo() };
    const read = await readAssetFile(deps, {
      userId: "u-random-member",
      orgId,
      assetKind: "skill",
      assetId: "sk-1",
      path: "SKILL.md",
    });
    expect(read.path).toBe("SKILL.md");
    expect(typeof read.body).toBe("string");
  });

  it("在 editableBy 集合内的账号 -> 写成功", async () => {
    const deps = { repo: memberRepo, assets: new FixtureAssetFileRepository(), governance: await governedRepo() };
    const result = await writeAssetFile(deps, {
      userId: "u-maintainer",
      orgId,
      assetKind: "skill",
      assetId: "sk-1",
      path: "references/output-schema.md",
      body: "updated by a maintainer\n",
    });
    expect(result.dirty).toBe(true);
  });

  it("负责人（ownerId）本人 -> 写成功，即使不在 editableBy 列表里", async () => {
    const deps = { repo: memberRepo, assets: new FixtureAssetFileRepository(), governance: await governedRepo() };
    const result = await writeAssetFile(deps, {
      userId: "u-owner",
      orgId,
      assetKind: "skill",
      assetId: "sk-1",
      path: "references/output-schema.md",
      body: "updated by the owner\n",
    });
    expect(result.dirty).toBe(true);
  });

  it("从未配置过治理的资产 -> 没有限制可判定，任何组织成员可写（与 SetAssetGovernance 的 bootstrap 规则一致）", async () => {
    const deps = {
      repo: memberRepo,
      assets: new FixtureAssetFileRepository(),
      governance: new InMemoryAssetGovernanceRepository(),
    };
    const result = await writeAssetFile(deps, {
      userId: "u-random-member",
      orgId,
      assetKind: "skill",
      assetId: "sk-2",
      path: "references/output-schema.md",
      body: "no governance configured yet\n",
    });
    expect(result.dirty).toBe(true);
  });

  it("组织外成员 -> ORG_SCOPE_DENIED，在 editableBy 判定之前就被拦下（不泄露是否存在）", async () => {
    const deps = { repo: memberRepo, assets: new FixtureAssetFileRepository(), governance: await governedRepo() };
    await expect(
      writeAssetFile(deps, {
        userId: "u-outsider",
        orgId,
        assetKind: "skill",
        assetId: "sk-1",
        path: "SKILL.md",
        body: "irrelevant\n",
      }),
    ).rejects.toBeInstanceOf(AssetOrgScopeDeniedError);
  });
});
