/**
 * product-skill-pack-build.test.ts —— Phase 20 CT04
 * （`05-content-lines.md` R3 步骤 5 / R4 E1 / V1；契约束 `work-content`）。
 *
 * 断言 user_visible_behavior：27 个 v2 实体写成包并可被 WS02 导入端同一核验解析；D011 的 3 条
 * skillGap 以 skillGaps 登记在角色包、不造新 Skill；构建可重复 digest 一致；manifest 缺 v2 ID /
 * digest 不符 / 引用未 PASS 实体时构建（含 CLI 进程）退出非 0。
 *
 * 不连接数据库——纯文件系统/纯函数 + 一次 CLI 子进程。
 */
import { describe, expect, it } from "vitest";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import {
  buildWorkProductPack as buildRaw,
  DEFAULT_ROOT,
  DEFAULT_V2_ROOT,
  expectedStableIds,
  publishedPackPath,
  SKILL_GAPS_FILE,
  type BuildOptions,
  PACK_ID,
  PACK_VERSION,
  WorkContentPackBuildError,
} from "../../scripts/build-work-product-skill-pack";
import { buildWorkResearchPack } from "../../scripts/build-work-research-skill-pack";
import { verifySkillStarterPack } from "../../src/domain/skill/starter-pack";
import { checkWorkSkillManifests } from "../../src/domain/skill/work-skill-import-check";
import { FileSkillStarterPackSource } from "../../src/infrastructure/skill/file-skill-starter-pack-source";

const EMPTY_OUT = mkdtempSync(join(tmpdir(), "work-product-out-"));
/** 默认不带已发布产物（digest 一致性单独测），返回 pack。 */
const buildWorkProductPack = (opts: BuildOptions | string = {}) =>
  buildRaw({ outRoot: EMPTY_OUT, ...(typeof opts === "string" ? { root: opts } : opts) }).pack;

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
  it("EXPECTED_STABLE_IDS 恰为 27 个实体，且与构建脚本从组合矩阵派生的期望集合一致", () => {
    expect(expectedStableIds()).toEqual(EXPECTED_STABLE_IDS);
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
      // 字节级：正文改一份不改另一份也要红（不是只比 metadata.work）。
      const files = (s: typeof inProduct) => s!.files.map((f) => `${f.path}:${f.digest}`);
      expect(files(inProduct)).toEqual(files(inResearch));
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

  function expectBuildError(opts: BuildOptions): WorkContentPackBuildError {
    let caught: unknown;
    try {
      buildRaw(opts);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(WorkContentPackBuildError);
    return caught as WorkContentPackBuildError;
  }

  it("E1 缺 v2 ID：删掉一个 Skill 目录 ⇒ 拒绝整包并指名缺失实体（不生成半个 pack）", () => {
    const tempRoot = copyRootToTemp();
    try {
      rmSync(resolve(tempRoot, "product-discovery"), { recursive: true });
      const error = expectBuildError({ root: tempRoot, outRoot: EMPTY_OUT });
      expect(error.issues.some((issue) => issue.fieldPath === "S061")).toBe(true);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("E1 多出/重复：拷贝一个 Skill 成第二个目录（同 stableId）⇒ 拒绝", () => {
    const tempRoot = copyRootToTemp();
    try {
      cpSync(resolve(tempRoot, "prioritization"), resolve(tempRoot, "prioritization-copy"), { recursive: true });
      const md = resolve(tempRoot, "prioritization-copy", "SKILL.md");
      writeFileSync(md, readFileSync(md, "utf8").replace("name: prioritization", "name: prioritization-copy"));
      const error = expectBuildError({ root: tempRoot, outRoot: EMPTY_OUT });
      expect(error.issues.some((issue) => issue.file === "prioritization-copy/SKILL.md" && /重复/.test(issue.message))).toBe(true);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("E1 引用未 PASS 实体：某 Skill 的评审结论不是 PASS（或评审缺失）⇒ 拒绝并指名实体 ID", () => {
    const v2 = mkdtempSync(join(tmpdir(), "work-product-v2-"));
    try {
      cpSync(resolve(DEFAULT_V2_ROOT, "DIGITALHUMAN-COMPOSITION-MATRIX.md"), resolve(v2, "DIGITALHUMAN-COMPOSITION-MATRIX.md"));
      cpSync(resolve(DEFAULT_V2_ROOT, "reviews"), resolve(v2, "reviews"), { recursive: true });
      const review = resolve(v2, "reviews", "S068.review.md");
      writeFileSync(review, readFileSync(review, "utf8").replace("Verdict: PASS", "Verdict: REVISE"));
      rmSync(resolve(v2, "reviews", "D011.review.md"));
      const error = expectBuildError({ v2Root: v2, outRoot: EMPTY_OUT });
      expect(error.issues.some((issue) => issue.fieldPath === "S068" && /REVISE/.test(issue.message))).toBe(true);
      expect(error.issues.some((issue) => issue.fieldPath === "D011" && /缺失/.test(issue.message))).toBe(true);
    } finally {
      rmSync(v2, { recursive: true, force: true });
    }
  });

  it("D011 的 3 条 skillGap 以 skillGaps 登记在角色包（与组合矩阵逐字一致），且不造新 Skill", () => {
    const { skillGaps, pack } = buildRaw({ outRoot: EMPTY_OUT });
    expect(skillGaps).toEqual({ D011: ["Persona/Journey facilitation", "HMW framing", "Prototype planning"] });
    const names = pack.skills.map((s) => s.stableName.toLowerCase());
    for (const gap of skillGaps.D011!) expect(names).not.toContain(gap.toLowerCase());

    const tempRoot = copyRootToTemp();
    try {
      const file = resolve(tempRoot, SKILL_GAPS_FILE);
      writeFileSync(file, JSON.stringify({ skillGaps: { D011: ["Persona/Journey facilitation", "HMW framing"] } }));
      const error = expectBuildError({ root: tempRoot, outRoot: EMPTY_OUT });
      expect(error.issues.some((issue) => issue.fieldPath === "skillGaps.D011")).toBe(true);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it("E1 digest 不符：已发布产物被篡改（文件 digest 与内容不符）或与源不一致 ⇒ 拒绝", () => {
    const out = mkdtempSync(join(tmpdir(), "work-product-pub-"));
    try {
      const { pack } = buildRaw({ outRoot: out });
      const published = publishedPackPath(out);
      cpSync(publishedPackPath(), published);
      // 仓库里的已发布产物与源一致（否则仓库本身就是 digest 不符）。
      expect(buildRaw({ outRoot: out }).pack.packDigest).toBe(pack.packDigest);

      const tampered = JSON.parse(readFileSync(published, "utf8"));
      tampered.skills[0].files[0].digest = "0".repeat(64);
      writeFileSync(published, JSON.stringify(tampered));
      expect(expectBuildError({ outRoot: out }).issues[0]!.fieldPath).toBe("digest");

      // 源变了但版本没升：已发布产物自洽，但 packDigest 与本次构建不同。
      const tempRoot = copyRootToTemp();
      try {
        cpSync(publishedPackPath(), published);
        const md = resolve(tempRoot, "prioritization", "SKILL.md");
        writeFileSync(md, `${readFileSync(md, "utf8")}\n<!-- edited -->\n`);
        expect(expectBuildError({ root: tempRoot, outRoot: out }).issues[0]!.fieldPath).toBe("packDigest");
      } finally {
        rmSync(tempRoot, { recursive: true, force: true });
      }
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });

  it("导入：已发布产物经 WS02 导入端同一读取 + 核验（FileSkillStarterPackSource → verifySkillStarterPack → checkWorkSkillManifests）通过", async () => {
    expect(existsSync(publishedPackPath())).toBe(true);
    const raw = await new FileSkillStarterPackSource(resolve(publishedPackPath(), "../..")).load(PACK_ID, PACK_VERSION);
    const pack = verifySkillStarterPack(raw, { packId: PACK_ID, packVersion: PACK_VERSION });
    expect(pack.skills.map((s) => s.name).sort()).toEqual(EXPECTED_STABLE_IDS);
    const check = checkWorkSkillManifests(pack);
    expect(check.kind).not.toBe("rejected");
  });

  it("CLI：缺一个 Skill 时进程退出码非 0 且不写出产物；完整源时退出 0 并写出可导入产物", () => {
    const tsx = resolve(__dirname, "../../node_modules/.bin/tsx");
    const script = resolve(__dirname, "../../scripts/build-work-product-skill-pack.ts");
    const tempRoot = copyRootToTemp();
    const out = mkdtempSync(join(tmpdir(), "work-product-cli-"));
    try {
      rmSync(resolve(tempRoot, "kpi-design"), { recursive: true });
      const bad = spawnSync(tsx, [script], { env: { ...process.env, WORK_PRODUCT_PACK_ROOT: tempRoot, WORK_PRODUCT_PACK_OUT: out }, encoding: "utf8" });
      expect(bad.status).not.toBe(0);
      expect(bad.stderr).toContain("缺少该 v2 实体");
      expect(existsSync(publishedPackPath(out))).toBe(false);

      const good = spawnSync(tsx, [script], { env: { ...process.env, WORK_PRODUCT_PACK_ROOT: DEFAULT_ROOT, WORK_PRODUCT_PACK_OUT: out }, encoding: "utf8" });
      expect(good.status).toBe(0);
      verifySkillStarterPack(JSON.parse(readFileSync(publishedPackPath(out), "utf8")), { packId: PACK_ID, packVersion: PACK_VERSION });
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
      rmSync(out, { recursive: true, force: true });
    }
  }, 60_000);
});
