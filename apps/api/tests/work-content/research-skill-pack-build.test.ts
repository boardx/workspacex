/**
 * research-skill-pack-build.test.ts —— Phase 20 CT01
 * （`05-content-lines.md` R3 步骤 1 / V1；契约束 `work-content`）。
 *
 * 断言 user_visible_behavior：D002 矩阵行 10 个研究 Skill 及其 Workflow 依赖
 * （共 18 个 v2 实体）按 SKILL.md + references/ 产出、构建脚本产出 starter-pack JSON，
 * 每个文件 digest=sha256、重复构建 digest 不变；篡改任一 SKILL.md 后构建退出非 0 并指名文件。
 *
 * 不连接数据库——本 feature 只是构建脚本 + 文件系统，纯函数级验证，与 WS01 lint 测试同类。
 */
import { describe, expect, it } from "vitest";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import {
  buildWorkResearchPack,
  DEFAULT_ROOT,
  PACK_ID,
  PACK_VERSION,
  WorkContentPackBuildError,
} from "../../scripts/build-work-research-skill-pack";

/** D002 研究线矩阵行的 10 个 Skill + 其 Workflow 依赖的 8 个 Skill（05-content-lines.md R3.1）。 */
const EXPECTED_STABLE_IDS = [
  "S003", "S063", "S171", "S169", "S172", "S170", "S016", "S020", "S168", "S167",
  "S010", "S012", "S017", "S157", "S158", "S160", "S161", "S164",
].sort();

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** 把真实源拷到一份临时目录，测试可以在拷贝上「篡改」而不动仓库内容。 */
function copyRootToTemp(): string {
  const dir = mkdtempSync(join(tmpdir(), "work-research-pack-"));
  cpSync(DEFAULT_ROOT, dir, { recursive: true });
  return dir;
}

describe("CT01 · 研究线 Skill 包构建（work-research starter-pack）", () => {
  it("对 18 个 v2 实体各产出恰好一份 SKILL.md，v2 ID 齐全且不重复（无半个 pack）", () => {
    const pack = buildWorkResearchPack();
    expect(pack.packId).toBe(PACK_ID);
    expect(pack.packVersion).toBe(PACK_VERSION);
    const stableIds = pack.skills.map((skill) => skill.name).sort();
    expect(stableIds).toEqual(EXPECTED_STABLE_IDS);
    expect(new Set(stableIds).size).toBe(EXPECTED_STABLE_IDS.length);
  });

  it("每个文件的 digest 都是其字节内容的 sha256（每份构建产物独立核验，不信任脚本自称）", () => {
    const pack = buildWorkResearchPack();
    for (const skill of pack.skills) {
      for (const file of skill.files) {
        const bytes = Buffer.from(file.contentBase64, "base64");
        expect(file.digest).toBe(sha256(bytes));
      }
      // 每个 skill 恰好一个根 SKILL.md（starter-pack 契约的既有不变量，见 verifySkillStarterPack）。
      expect(file_count_of(skill, "SKILL.md")).toBe(1);
    }

    function file_count_of(skill: (typeof pack.skills)[number], path: string): number {
      return skill.files.filter((f) => f.path === path).length;
    }
  });

  it("同一份源两次构建，packDigest 与每个文件 digest 都不变（R10 可重复构建）", () => {
    const first = buildWorkResearchPack();
    const second = buildWorkResearchPack();
    expect(second.packDigest).toBe(first.packDigest);
    const digestsOf = (pack: typeof first) =>
      pack.skills
        .flatMap((skill) => skill.files.map((file) => `${skill.stableName}/${file.path}:${file.digest}`))
        .sort();
    expect(digestsOf(second)).toEqual(digestsOf(first));
  });

  it("篡改任一 SKILL.md（改坏 metadata.work.stableId 的格式）后，构建退出非 0 并指名该文件", () => {
    const tempRoot = copyRootToTemp();
    try {
      const target = resolve(tempRoot, "enterprise-search", "SKILL.md");
      const original = readFileSync(target, "utf8");
      const tampered = original.replace("stableId: S003", "stableId: NOT-A-VALID-ID");
      expect(tampered).not.toBe(original);
      writeFileSync(target, tampered);

      expect(() => buildWorkResearchPack(tempRoot)).toThrow(WorkContentPackBuildError);
      try {
        buildWorkResearchPack(tempRoot);
        expect.unreachable("tampered manifest must reject the build");
      } catch (error) {
        expect(error).toBeInstanceOf(WorkContentPackBuildError);
        const build = error as WorkContentPackBuildError;
        expect(build.issues.length).toBeGreaterThan(0);
        expect(build.issues.some((issue) => issue.file === "enterprise-search/SKILL.md")).toBe(true);
        expect(build.issues.some((issue) => issue.fieldPath.includes("stableId"))).toBe(true);
      }
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("篡改 metadata.work 使其完全无法解析（YAML 损坏）时同样拒绝整包，且不是把该 skill 悄悄跳过", () => {
    const tempRoot = copyRootToTemp();
    try {
      const target = resolve(tempRoot, "risk-assessment", "SKILL.md");
      const original = readFileSync(target, "utf8");
      // 破坏 frontmatter 的 YAML 结构（未闭合的方括号），parseWorkSkillManifest 必须报 invalid 而非 absent。
      const tampered = original.replace("required:", "required: [broken");
      expect(tampered).not.toBe(original);
      writeFileSync(target, tampered);

      let caught: unknown;
      try {
        buildWorkResearchPack(tempRoot);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(WorkContentPackBuildError);
      const build = caught as WorkContentPackBuildError;
      expect(build.issues.some((issue) => issue.file === "risk-assessment/SKILL.md")).toBe(true);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("删掉一个 Skill 的 metadata.work（普通化）后拒绝整包并指名该文件——18 个缺一不可（E1 语义）", () => {
    const tempRoot = copyRootToTemp();
    try {
      const target = resolve(tempRoot, "sql-query", "SKILL.md");
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
        buildWorkResearchPack(tempRoot);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(WorkContentPackBuildError);
      const build = caught as WorkContentPackBuildError;
      expect(build.issues.some((issue) => issue.file === "sql-query/SKILL.md")).toBe(true);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
