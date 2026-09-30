/**
 * resolution-skill-pack-build.test.ts —— 问题到解决线 Skill 包构建（work-resolution starter-pack） 的 starter-pack 构建（镜像 research-skill-pack-build.test.ts）。
 *
 * 断言：覆盖集合恰为 S011 与 S015；每个文件 digest = sha256；重复构建 digest 不变；
 * 篡改任一 SKILL.md 后整包拒绝并指名文件；已提交的 skills/starter-packs/work-resolution/1.0.0.json 与源逐字节一致
 * （源变了必须重跑构建脚本）；导入侧 checkWorkSkillManifests（WS02：manifest 合法 + 依赖分类已登记）通过。
 * 不连接数据库（DB 侧导入由 starter-packs-live-stack.test.ts 覆盖，本机无 DB 时未运行）。
 */
import { describe, expect, it } from "vitest";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import {
  buildWorkResolutionPack,
  checkCommittedPack,
  DEFAULT_ROOT,
  EXPECTED_STABLE_IDS,
  PACK_ID,
  PACK_VERSION,
  specFor,
  WorkContentPackBuildError,
} from "../../scripts/build-work-resolution-skill-pack";
import { checkWorkSkillManifests } from "../../src/domain/skill/work-skill-import-check";

const EXPECTED = ["S011", "S015"];
const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

function copyRootToTemp(): string {
  const dir = mkdtempSync(join(tmpdir(), "work-resolution-pack-"));
  cpSync(DEFAULT_ROOT, dir, { recursive: true });
  return dir;
}

function issuesOf(fn: () => unknown): WorkContentPackBuildError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(WorkContentPackBuildError);
    return error as WorkContentPackBuildError;
  }
  throw new Error("expected the build to be rejected");
}

describe("问题到解决线 Skill 包构建（work-resolution starter-pack）", () => {
  it("覆盖集合恰为 S011 与 S015，v2 ID 齐全且不重复", () => {
    const pack = buildWorkResolutionPack();
    expect(pack.packId).toBe(PACK_ID);
    expect(pack.packVersion).toBe(PACK_VERSION);
    expect(pack.skills.map((s) => s.name).sort()).toEqual([...EXPECTED].sort());
    expect([...EXPECTED_STABLE_IDS].sort()).toEqual([...EXPECTED].sort());
  });

  it("每个文件的 digest 都是其字节的 sha256；每个 skill 恰一个根 SKILL.md", () => {
    for (const skill of buildWorkResolutionPack().skills) {
      for (const file of skill.files) expect(file.digest).toBe(sha256(Buffer.from(file.contentBase64, "base64")));
      expect(skill.files.filter((f) => f.path === "SKILL.md")).toHaveLength(1);
    }
  });

  it("同一份源两次构建，packDigest 不变（可重复构建）", () => {
    expect(buildWorkResolutionPack().packDigest).toBe(buildWorkResolutionPack().packDigest);
  });

  it("已提交的 pack JSON 与源重建结果逐字节一致（源变了必须重跑构建脚本）", () => {
    expect(checkCommittedPack(specFor())).toEqual([]);
  });

  it("导入侧校验：manifest 合法、依赖分类全部已登记、provenance 完整（WS02 E6/E8）", () => {
    const check = checkWorkSkillManifests(buildWorkResolutionPack());
    expect(check.kind === "rejected" ? check.issues : []).toEqual([]);
    expect(check.kind).toBe("ok");
  });

  it("每个 SKILL.md 都带内联的、可编译的 input/outputSchema（不是只有 $ref 的占位）", () => {
    const check = checkWorkSkillManifests(buildWorkResolutionPack());
    if (check.kind !== "ok") throw new Error("import check failed");
    for (const [, manifest] of check.manifests) {
      for (const schema of [manifest.inputSchema, manifest.outputSchema]) {
        expect(JSON.stringify(schema)).not.toContain("$ref");
        expect(Object.keys(schema).length).toBeGreaterThan(0);
      }
    }
  });

  it("篡改任一 SKILL.md（stableId 格式坏掉）后拒绝整包并指名该文件", () => {
    const root = copyRootToTemp();
    try {
      const target = resolve(root, "root-cause-analysis", "SKILL.md");
      const original = readFileSync(target, "utf8");
      const tampered = original.replace("stableId: S011", "stableId: NOT-A-VALID-ID");
      expect(tampered).not.toBe(original);
      writeFileSync(target, tampered);
      const build = issuesOf(() => buildWorkResolutionPack(root));
      expect(build.issues.some((i) => i.file === "root-cause-analysis/SKILL.md" && i.fieldPath.includes("stableId"))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("删掉一个 skill 的 metadata.work（普通化）后拒绝整包——覆盖集合缺一不可", () => {
    const root = copyRootToTemp();
    try {
      const target = resolve(root, "root-cause-analysis", "SKILL.md");
      const original = readFileSync(target, "utf8");
      const start = original.indexOf("\nmetadata:\n");
      const end = original.indexOf("\n---\n", start);
      expect(start).toBeGreaterThan(-1);
      writeFileSync(target, original.slice(0, start) + original.slice(end));
      const build = issuesOf(() => buildWorkResolutionPack(root));
      expect(build.issues.some((i) => i.file === "root-cause-analysis/SKILL.md")).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
