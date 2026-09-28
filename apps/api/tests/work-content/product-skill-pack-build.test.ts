/**
 * product-skill-pack-build.test.ts —— Phase 20 CT04
 * （`05-content-lines.md` R3 步骤 5 / V1；契约束 `work-content`）。
 *
 * 断言 user_visible_behavior：D003 矩阵行 14 个 Skill 与 D011 矩阵行 9 个 Skill（并集去重）
 * 及 W030/W031/W032/W002 额外依赖，共 27 个 v2 实体按 SKILL.md + references/ 产出、构建脚本
 * 产出 starter-pack JSON，每个文件 digest=sha256、重复构建 digest 不变；篡改任一 SKILL.md 后
 * 构建退出非 0 并指名文件。D011 的 3 条 skillGap 不造新 Skill，故不在期望集合中。
 *
 * 不连接数据库——本 feature 只是构建脚本 + 文件系统，纯函数级验证，与 CT01 同类。
 */
import { describe, expect, it } from "vitest";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import {
  buildWorkProductPack,
  DEFAULT_ROOT,
  PACK_ID,
  PACK_VERSION,
  WorkContentPackBuildError,
} from "../../scripts/build-work-product-skill-pack";
import { buildWorkResearchPack } from "../../scripts/build-work-research-skill-pack";

/**
 * D003 矩阵行 14 个 Skill ∪ D011 矩阵行 9 个 Skill（去重）∪ W030/W031/W032/W002 额外依赖
 * （05-content-lines.md R3.5；DIGITALHUMAN-COMPOSITION-MATRIX.md 第 9/17 行）。
 */
const D003 = ["S061", "S009", "S064", "S065", "S067", "S068", "S069", "S070", "S071", "S072", "S073", "S074", "S008", "S075"];
const D011 = ["S062", "S009", "S064", "S065", "S066", "S071", "S063", "S075", "S018"];
const EXTRA_DEPS = ["S070", "S142", "S076", "S157", "S161", "S074", "S155", "S006", "S017", "S007", "S162"];
const EXPECTED_STABLE_IDS = Array.from(new Set([...D003, ...D011, ...EXTRA_DEPS])).sort();

/** 与研究线共用的 4 个 Skill 实体（同一实体在两个 pack 里各有一份文件副本，非第二份事实源）。 */
const SHARED_WITH_RESEARCH = ["S063", "S017", "S157", "S161"];

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** 把真实源拷到一份临时目录，测试可以在拷贝上「篡改」而不动仓库内容。 */
function copyRootToTemp(): string {
  const dir = mkdtempSync(join(tmpdir(), "work-product-pack-"));
  cpSync(DEFAULT_ROOT, dir, { recursive: true });
  return dir;
}

describe("CT04 · 产品线 Skill 包作者化与导入（work-product starter-pack）", () => {
  it("EXPECTED_STABLE_IDS 恰为 27 个实体：D003(14) ∪ D011(9) ∪ 额外依赖，去重不缺一", () => {
    expect(D003.length).toBe(14);
    expect(D011.length).toBe(9);
    expect(EXPECTED_STABLE_IDS.length).toBe(27);
    expect(new Set(EXPECTED_STABLE_IDS).size).toBe(27);
  });

  it("对 27 个 v2 实体各产出恰好一份 SKILL.md，v2 ID 齐全且不重复（无半个 pack）", () => {
    const pack = buildWorkProductPack();
    expect(pack.packId).toBe(PACK_ID);
    expect(pack.packVersion).toBe(PACK_VERSION);
    const stableIds = pack.skills.map((skill) => skill.name).sort();
    expect(stableIds).toEqual(EXPECTED_STABLE_IDS);
    expect(new Set(stableIds).size).toBe(EXPECTED_STABLE_IDS.length);
  });

  it("每个文件的 digest 都是其字节内容的 sha256（每份构建产物独立核验，不信任脚本自称）", () => {
    const pack = buildWorkProductPack();
    for (const skill of pack.skills) {
      for (const file of skill.files) {
        const bytes = Buffer.from(file.contentBase64, "base64");
        expect(file.digest).toBe(sha256(bytes));
      }
      expect(skill.files.filter((f) => f.path === "SKILL.md").length).toBe(1);
    }
  });

  it("同一份源两次构建，packDigest 与每个文件 digest 都不变（R10 可重复构建）", () => {
    const first = buildWorkProductPack();
    const second = buildWorkProductPack();
    expect(second.packDigest).toBe(first.packDigest);
    const digestsOf = (pack: typeof first) =>
      pack.skills
        .flatMap((skill) => skill.files.map((file) => `${skill.stableName}/${file.path}:${file.digest}`))
        .sort();
    expect(digestsOf(second)).toEqual(digestsOf(first));
  });

  it("与研究线共用的 4 个实体（S063/S017/S157/S161）在两个 pack 中 metadata.work 一致，不是第二份事实源", () => {
    const productPack = buildWorkProductPack();
    const researchPack = buildWorkResearchPack();
    for (const stableId of SHARED_WITH_RESEARCH) {
      const inProduct = productPack.skills.find((s) => s.name === stableId);
      const inResearch = researchPack.skills.find((s) => s.name === stableId);
      expect(inProduct, `${stableId} 应在 work-product pack 中`).toBeDefined();
      expect(inResearch, `${stableId} 应在 work-research pack 中`).toBeDefined();
      expect(inProduct!.manifest.work).toEqual(inResearch!.manifest.work);
    }
  });

  it("篡改任一 SKILL.md（改坏 metadata.work.stableId 的格式）后，构建退出非 0 并指名该文件", () => {
    const tempRoot = copyRootToTemp();
    try {
      const target = resolve(tempRoot, "product-discovery", "SKILL.md");
      const original = readFileSync(target, "utf8");
      const tampered = original.replace("stableId: S061", "stableId: NOT-A-VALID-ID");
      expect(tampered).not.toBe(original);
      writeFileSync(target, tampered);

      expect(() => buildWorkProductPack(tempRoot)).toThrow(WorkContentPackBuildError);
      try {
        buildWorkProductPack(tempRoot);
        expect.unreachable("tampered manifest must reject the build");
      } catch (error) {
        expect(error).toBeInstanceOf(WorkContentPackBuildError);
        const build = error as WorkContentPackBuildError;
        expect(build.issues.length).toBeGreaterThan(0);
        expect(build.issues.some((issue) => issue.file === "product-discovery/SKILL.md")).toBe(true);
        expect(build.issues.some((issue) => issue.fieldPath.includes("stableId"))).toBe(true);
      }
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("篡改 metadata.work 使其完全无法解析（YAML 损坏）时同样拒绝整包，且不是把该 skill 悄悄跳过", () => {
    const tempRoot = copyRootToTemp();
    try {
      const target = resolve(tempRoot, "prd-spec-writing", "SKILL.md");
      const original = readFileSync(target, "utf8");
      // 破坏 frontmatter 的 YAML 结构（未闭合的方括号），parseWorkSkillManifest 必须报 invalid 而非 absent。
      const tampered = original.replace("required:", "required: [broken");
      expect(tampered).not.toBe(original);
      writeFileSync(target, tampered);

      let caught: unknown;
      try {
        buildWorkProductPack(tempRoot);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(WorkContentPackBuildError);
      const build = caught as WorkContentPackBuildError;
      expect(build.issues.some((issue) => issue.file === "prd-spec-writing/SKILL.md")).toBe(true);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("删掉一个 Skill 的 metadata.work（普通化）后拒绝整包并指名该文件——27 个缺一不可（E1 语义）", () => {
    const tempRoot = copyRootToTemp();
    try {
      const target = resolve(tempRoot, "prioritization", "SKILL.md");
      const original = readFileSync(target, "utf8");
      // frontmatter 的 `metadata:` 块从该行起一直到闭合的 `---`；整块删掉即得到一个
      // 没有 metadata.work 的「普通」SKILL.md（其余顶层字段 name/version/capability_id 保留）。
      const metadataStart = original.indexOf("\nmetadata:\n");
      const fenceEnd = original.indexOf("\n---\n");
      expect(metadataStart).toBeGreaterThan(-1);
      expect(fenceEnd).toBeGreaterThan(metadataStart);
      const tampered = original.slice(0, metadataStart) + original.slice(fenceEnd);
      expect(tampered).not.toContain("metadata:");
      writeFileSync(target, tampered);

      let caught: unknown;
      try {
        buildWorkProductPack(tempRoot);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(WorkContentPackBuildError);
      const build = caught as WorkContentPackBuildError;
      expect(build.issues.some((issue) => issue.file === "prioritization/SKILL.md")).toBe(true);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
