/**
 * F142 -- `WriteAssetFile` root-file frontmatter gate (`uc-23-3` E2, R12-10).
 *
 * Pure application-layer test, no Postgres (issue #74): `FixtureAssetFileRepository` and
 * `InMemoryAssetGovernanceRepository` are the real phase-1 adapters, just constructed in
 * memory rather than through the NestJS module.
 *
 * ⚠ The acceptance line is TWO things together, not one: (a) the save is rejected with
 * `CONTRACT_VALIDATION_FAILED` and (b) the bad body never reaches storage -- a `readAssetFile`
 * right after the rejected write must still return the OLD content. Asserting only the thrown
 * error would pass an implementation that writes first and complains second.
 */
import { describe, expect, it } from "vitest";
import { toOrgId } from "../../src/domain/org-id";
import type { OrgMembershipRow } from "../../src/application/identity/ports";
import { FixtureAssetFileRepository } from "../../src/infrastructure/asset/fixture-asset-file-repository";
import { InMemoryAssetGovernanceRepository } from "../../src/infrastructure/asset/in-memory-asset-governance-repository";
import { readAssetFile } from "../../src/application/asset/read-asset-file";
import { AssetContractValidationFailedError, writeAssetFile } from "../../src/application/asset/write-asset-file";

const orgId = toOrgId("org-1");
const member: OrgMembershipRow = { orgRole: "consultant", teamId: null };
const memberRepo = { findOrgMembership: async () => member };

function deps() {
  return { repo: memberRepo, assets: new FixtureAssetFileRepository(), governance: new InMemoryAssetGovernanceRepository() };
}

const VALID_SKILL_MD = `---
name: MECE 假设拆解
description: 把商业问题拆成互斥穷尽的假设树
allowed-tools: Read, Grep, WebSearch
---

# body
`;

async function expectValidationFailure(body: string, expectedFields: readonly string[]) {
  const d = deps();
  await expect(
    writeAssetFile(d, { userId: "u1", orgId, assetKind: "skill", assetId: "sk-1", path: "SKILL.md", body }),
  ).rejects.toSatisfy((e: unknown) => {
    expect(e).toBeInstanceOf(AssetContractValidationFailedError);
    expect((e as AssetContractValidationFailedError).issues.map((i) => i.field)).toEqual(expectedFields);
    return true;
  });
  // 库里内容未变 -- 读回来的还是 fixture 的原始 SKILL.md，不是这次被拒的坏内容。
  const read = await readAssetFile(d, { userId: "u1", orgId, assetKind: "skill", assetId: "sk-1", path: "SKILL.md" });
  expect(read.body).not.toBe(body);
}

describe("WriteAssetFile -- 根文件 frontmatter 校验 (uc-23-3 E2)", () => {
  it("合法 frontmatter -> 保存成功，读回来是新内容，大小随之更新", async () => {
    const d = deps();
    const result = await writeAssetFile(d, {
      userId: "u1",
      orgId,
      assetKind: "skill",
      assetId: "sk-1",
      path: "SKILL.md",
      body: VALID_SKILL_MD,
    });
    expect(result.dirty).toBe(true);
    expect(result.sizeBytes).toBe(Buffer.byteLength(VALID_SKILL_MD, "utf8"));

    const read = await readAssetFile(d, { userId: "u1", orgId, assetKind: "skill", assetId: "sk-1", path: "SKILL.md" });
    expect(read.body).toBe(VALID_SKILL_MD);
    expect(read.sizeBytes).toBe(Buffer.byteLength(VALID_SKILL_MD, "utf8"));
  });

  it("没有起始 `---` -> UNPARSEABLE，不入库", async () => {
    await expectValidationFailure("name: x\ndescription: y\nallowed-tools: Read\n", ["frontmatter"]);
  });

  it("没有结束 `---` -> UNPARSEABLE，不入库", async () => {
    await expectValidationFailure("---\nname: x\ndescription: y\nallowed-tools: Read\n", ["frontmatter"]);
  });

  it("frontmatter 里有一行不是 `key: value` 语法 -> UNPARSEABLE，不入库", async () => {
    await expectValidationFailure(
      "---\nname: x\nthis is not a key value line\ndescription: y\n---\nbody\n",
      ["frontmatter"],
    );
  });

  it("SKILL.md 缺 description -> 报缺 description 这一项，不入库", async () => {
    await expectValidationFailure("---\nname: x\nallowed-tools: Read\n---\nbody\n", ["description"]);
  });

  it("SKILL.md 三项全缺 -> 逐条列出三项，不入库", async () => {
    await expectValidationFailure("---\n---\nbody\n", ["name", "description", "allowed-tools"]);
  });

  it("AGENT.md 缺 model 与 memory -> 逐条列出这两项，不入库", async () => {
    const d = deps();
    const body = "---\nname: Ava\nrole: 战略分析师\nskills: [mece-decomposition]\n---\nbody\n";
    await expect(
      writeAssetFile(d, { userId: "u1", orgId, assetKind: "agent", assetId: "ag-1", path: "AGENT.md", body }),
    ).rejects.toSatisfy((e: unknown) => {
      expect(e).toBeInstanceOf(AssetContractValidationFailedError);
      expect((e as AssetContractValidationFailedError).issues.map((i) => i.field)).toEqual(["model", "memory"]);
      return true;
    });
    const read = await readAssetFile(d, { userId: "u1", orgId, assetKind: "agent", assetId: "ag-1", path: "AGENT.md" });
    expect(read.body).not.toBe(body);
  });

  it("非根文件（references/output-schema.md）不受 frontmatter 校验约束，随便写都能保存", async () => {
    const d = deps();
    const result = await writeAssetFile(d, {
      userId: "u1",
      orgId,
      assetKind: "skill",
      assetId: "sk-1",
      path: "references/output-schema.md",
      body: "no frontmatter at all, just prose\n",
    });
    expect(result.dirty).toBe(true);
  });
});
