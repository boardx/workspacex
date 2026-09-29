/**
 * sales-skill-pack-build.test.ts —— Phase 20 CT07
 * （`05-content-lines.md` R3 步骤 7 / V1；契约束 `work-content`）。
 *
 * 断言 user_visible_behavior：D005 矩阵行 14 个销售 Skill 与 W015/W016/W018 额外依赖
 * （S035/S033/S010/S009，共 18 个 v2 实体）按 SKILL.md + references/ 产出、构建脚本产出
 * starter-pack JSON，每个文件 digest=sha256、重复构建 digest 不变；篡改任一 SKILL.md 或引用
 * 未 PASS/格式非法的 metadata.work 后构建退出非 0 并指名文件。
 *
 * 不连接数据库——本 feature 只是构建脚本 + 文件系统，纯函数级验证，与 CT01 研究线测试同类。
 */
import { describe, expect, it } from "vitest";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import {
  buildWorkSalesPack,
  DEFAULT_ROOT,
  PACK_ID,
  PACK_VERSION,
  WorkContentPackBuildError,
} from "../../scripts/build-work-sales-skill-pack";

/**
 * D005 销售线矩阵行的 14 个 Skill + W015/W016/W018 额外依赖的 4 个 Skill
 * （05-content-lines.md R3.7；DIGITALHUMAN-COMPOSITION-MATRIX.md 第 11 行 D005，
 * WORKFLOW-SKILL-MATRIX.md 第 21/22/24 行）。
 */
const EXPECTED_STABLE_IDS = [
  "S021", "S022", "S023", "S024", "S025", "S026", "S005", "S028", "S029", "S030", "S031", "S032", "S034", "S036",
  "S035", "S033", "S010", "S009",
].sort();

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** 把真实源拷到一份临时目录，测试可以在拷贝上「篡改」而不动仓库内容。 */
function copyRootToTemp(): string {
  const dir = mkdtempSync(join(tmpdir(), "work-sales-pack-"));
  cpSync(DEFAULT_ROOT, dir, { recursive: true });
  return dir;
}

describe("CT07 · 销售线 Skill 包构建（work-sales starter-pack）", () => {
  it("对 18 个 v2 实体各产出恰好一份 SKILL.md，v2 ID 齐全且不重复（无半个 pack）", () => {
    const pack = buildWorkSalesPack();
    expect(pack.packId).toBe(PACK_ID);
    expect(pack.packVersion).toBe(PACK_VERSION);
    const stableIds = pack.skills.map((skill) => skill.name).sort();
    expect(stableIds).toEqual(EXPECTED_STABLE_IDS);
    expect(new Set(stableIds).size).toBe(EXPECTED_STABLE_IDS.length);
  });

  it("每个文件的 digest 都是其字节内容的 sha256（每份构建产物独立核验，不信任脚本自称）", () => {
    const pack = buildWorkSalesPack();
    for (const skill of pack.skills) {
      for (const file of skill.files) {
        const bytes = Buffer.from(file.contentBase64, "base64");
        expect(file.digest).toBe(sha256(bytes));
      }
      // 每个 skill 恰好一个根 SKILL.md（starter-pack 契约的既有不变量，见 verifySkillStarterPack）。
      expect(fileCountOf(skill, "SKILL.md")).toBe(1);
    }

    function fileCountOf(skill: (typeof pack.skills)[number], path: string): number {
      return skill.files.filter((f) => f.path === path).length;
    }
  });

  it("同一份源两次构建，packDigest 与每个文件 digest 都不变（R10 可重复构建）", () => {
    const first = buildWorkSalesPack();
    const second = buildWorkSalesPack();
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
      const target = resolve(tempRoot, "prospecting", "SKILL.md");
      const original = readFileSync(target, "utf8");
      const tampered = original.replace("stableId: S024", "stableId: NOT-A-VALID-ID");
      expect(tampered).not.toBe(original);
      writeFileSync(target, tampered);

      expect(() => buildWorkSalesPack(tempRoot)).toThrow(WorkContentPackBuildError);
      try {
        buildWorkSalesPack(tempRoot);
        expect.unreachable("tampered manifest must reject the build");
      } catch (error) {
        expect(error).toBeInstanceOf(WorkContentPackBuildError);
        const build = error as WorkContentPackBuildError;
        expect(build.issues.length).toBeGreaterThan(0);
        expect(build.issues.some((issue) => issue.file === "prospecting/SKILL.md")).toBe(true);
        expect(build.issues.some((issue) => issue.fieldPath.includes("stableId"))).toBe(true);
      }
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("篡改 metadata.work 使其完全无法解析（YAML 损坏）时同样拒绝整包，且不是把该 skill 悄悄跳过", () => {
    const tempRoot = copyRootToTemp();
    try {
      const target = resolve(tempRoot, "opportunity-update", "SKILL.md");
      const original = readFileSync(target, "utf8");
      // 破坏 frontmatter 的 YAML 结构（未闭合的方括号），parseWorkSkillManifest 必须报 invalid 而非 absent。
      const tampered = original.replace("required:", "required: [broken");
      expect(tampered).not.toBe(original);
      writeFileSync(target, tampered);

      let caught: unknown;
      try {
        buildWorkSalesPack(tempRoot);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(WorkContentPackBuildError);
      const build = caught as WorkContentPackBuildError;
      expect(build.issues.some((issue) => issue.file === "opportunity-update/SKILL.md")).toBe(true);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("删掉一个 Skill 的 metadata.work（普通化）后拒绝整包并指名该文件——18 个缺一不可（E1 语义）", () => {
    const tempRoot = copyRootToTemp();
    try {
      const target = resolve(tempRoot, "customer-health", "SKILL.md");
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
        buildWorkSalesPack(tempRoot);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(WorkContentPackBuildError);
      const build = caught as WorkContentPackBuildError;
      expect(build.issues.some((issue) => issue.file === "customer-health/SKILL.md")).toBe(true);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("篡改依赖字段（required/optional 同时含相同能力分类）后拒绝整包（manifest 自身不变量）", () => {
    const tempRoot = copyRootToTemp();
    try {
      const target = resolve(tempRoot, "renewal-radar", "SKILL.md");
      const original = readFileSync(target, "utf8");
      expect(original).toContain('required:\n        - "crm.read"');
      const tampered = original.replace(
        'optional:\n        - "mail.search"',
        'optional:\n        - "crm.read"\n        - "mail.search"',
      );
      expect(tampered).not.toBe(original);
      writeFileSync(target, tampered);

      let caught: unknown;
      try {
        buildWorkSalesPack(tempRoot);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(WorkContentPackBuildError);
      const build = caught as WorkContentPackBuildError;
      expect(build.issues.some((issue) => issue.file === "renewal-radar/SKILL.md")).toBe(true);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
