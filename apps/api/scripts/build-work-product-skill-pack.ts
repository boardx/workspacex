/**
 * build-work-product-skill-pack.ts —— 产品线 Work Skill starter-pack 构建
 * （Phase 20 CT04，05-content-lines.md R3 步骤 5）。
 *
 * ⚠ 故意不放在 `skills/work-product/scripts/build.ts`（既有 `skills/<pack>/scripts/build.ts`
 * 惯例）：`lint-shipped-pack-version.mjs` 把那个路径形态一律当作「标准平台包」，要求它出现在
 * `ensure-standard-skill-packs.ts` 的 `STANDARD_PLATFORM_PACKS`（=每个新组织自动 seed）。
 * work-product 是 Work Skill pack（ADR-117），经由 WS02 `/admin/skills/starter-pack-imports`
 * 由平台运营显式导入，不是自动 seed 给所有组织的标准助理包——两者是不同的治理路径，混进同一张
 * 表会把「需要人工触发的导入」悄悄变成「所有组织都自动拥有」。放在 `apps/api/scripts/` 让两条
 * 治理路径的机械门各管各的，不产生假阳性（同 CT01 `build-work-research-skill-pack.ts` 的理由）。
 *
 * 扫描 `skills/work-product/` 下每个 `<slug>/SKILL.md`（+ `references/`），用**唯一**的
 * frontmatter 解析入口（`parseSkillFrontmatter` 读 stableName/semanticVersion/capabilityId，
 * `parseWorkSkillManifest` 读并校验 `metadata.work`，两者都是 WS01/WS02 已落地的单源函数，
 * 本文件不重新声明任何解析/校验规则），产出 `skills/starter-packs/work-product/<semver>.json`：
 *   - 每个文件的 `digest` = sha256（`starter-pack.ts` 的 `sha256`，同一份实现，不第二次实现）；
 *   - `metadata.work` 校验失败（E1）⇒ 整包构建失败，**不写出任何文件**，逐条打印
 *     `文件: 字段路径: 原因`（`formatWorkSkillManifestIssue`，与 WS01 lint 同一措辞）；
 *   - 同一份源两次构建 → 同一个 `packDigest`（R10）：文件字节不变、目录顺序固定排序。
 *
 * 覆盖 D003 矩阵行 14 个 Skill 与 D011 矩阵行 9 个 Skill（并集去重）以及 W030/W031/W032/W002
 * 额外依赖，共 27 个 v2 实体（05-content-lines.md R3.5）；其中 S063/S017/S157/S161 与研究线共用，
 * 内容与 `skills/work-research/` 下同名 Skill 一致（同一实体的不同 pack 副本，非第二份事实源——
 * 两个副本的 `metadata.work` 字段值必须相等，由本文件的测试跨包核对）。D011 的 3 条 skillGap
 * （Persona/Journey facilitation、HMW framing、Prototype planning）只登记在角色包，本构建脚本
 * 不产出任何对应 Skill（R6）。
 *
 * `buildWorkProductPack(root)` 是纯函数（只读 fs，不写），CLI 入口另起一段负责落盘——
 * 这样测试能对一份临时目录（例如篡改过某个 SKILL.md 的拷贝）跑同一份构建逻辑，
 * 不必依赖真实仓库内容，也不会把测试夹具误写回仓库。
 */
import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { sha256, verifySkillStarterPack, type SkillStarterPack } from "../src/domain/skill/starter-pack";
import { parseSkillFrontmatter } from "../src/domain/skill/skill-frontmatter";
import {
  parseWorkSkillManifest,
  formatWorkSkillManifestIssue,
  type WorkSkillManifestIssue,
} from "../src/domain/skill/work-skill-manifest";

export const PACK_ID = "work-product";
export const PACK_VERSION = "1.0.0";

const HERE = dirname(fileURLToPath(import.meta.url));
/** repo-root-relative `skills/work-product/` (this file lives at `apps/api/scripts/`). */
export const DEFAULT_ROOT = resolve(HERE, "../../../skills/work-product");

export class WorkContentPackBuildError extends Error {
  constructor(readonly issues: readonly WorkSkillManifestIssue[]) {
    super(
      `work-product pack 构建失败——${issues.length} 处 metadata.work 问题，未写出任何文件：\n` +
        issues.map(formatWorkSkillManifestIssue).join("\n"),
    );
  }
}

function mediaTypeFor(path: string): string {
  if (path.endsWith(".md")) return "text/markdown";
  if (path.endsWith(".json")) return "application/json";
  return "application/octet-stream";
}

/** 相对某个 skill 目录，递归列出全部文件（含 references/），排序固定以保证可重复构建。 */
function listSkillFiles(skillDir: string, base = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(resolve(skillDir, base), { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...listSkillFiles(skillDir, rel));
    else out.push(rel);
  }
  return out.sort();
}

function listSkillDirectories(root: string): string[] {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== "scripts")
    .map((entry) => entry.name)
    .filter((name) => existsSync(resolve(root, name, "SKILL.md")))
    .sort();
}

/**
 * 构建 work-product 包（纯函数：只读 `root` 下的文件，不写任何输出）。
 * 任一 skill 的 `metadata.work` 缺失/不合法 ⇒ 抛 `WorkContentPackBuildError`，
 * 携带全部问题（不是遇到第一个就停——E1 要求「列出实体 ID 与字段」，逐条才对得上）。
 */
export function buildWorkProductPack(root: string = DEFAULT_ROOT): SkillStarterPack {
  const directories = listSkillDirectories(root);
  const issues: WorkSkillManifestIssue[] = [];
  const skills: SkillStarterPack["skills"] = [];

  for (const directory of directories) {
    const skillDir = resolve(root, directory);
    const skillMdRelative = `${directory}/SKILL.md`;
    const markdown = readFileSync(resolve(skillDir, "SKILL.md"), "utf8");

    let frontmatter;
    try {
      frontmatter = parseSkillFrontmatter(markdown, directory);
    } catch (error) {
      issues.push({ file: skillMdRelative, fieldPath: "frontmatter", message: error instanceof Error ? error.message : String(error) });
      continue;
    }

    const work = parseWorkSkillManifest(skillMdRelative, markdown);
    if (work.kind === "absent") {
      issues.push({ file: skillMdRelative, fieldPath: "metadata.work", message: "work-product 包内的 SKILL.md 必须带 metadata.work（v2 实体 ID）" });
      continue;
    }
    if (work.kind === "invalid") {
      issues.push(...work.issues);
      continue;
    }

    const files = listSkillFiles(skillDir).map((path) => {
      const bytes = readFileSync(resolve(skillDir, path));
      return { path, mediaType: mediaTypeFor(path), digest: sha256(bytes), contentBase64: bytes.toString("base64") };
    });

    skills.push({
      stableName: frontmatter.stableName,
      name: work.manifest.stableId,
      semanticVersion: frontmatter.semanticVersion,
      manifest: { capabilityId: frontmatter.capabilityId, work: work.manifest },
      files,
    });
  }

  if (issues.length > 0) throw new WorkContentPackBuildError(issues);

  const unsigned = { schemaVersion: 1 as const, packId: PACK_ID, packVersion: PACK_VERSION, skills };
  const pack: SkillStarterPack = { ...unsigned, packDigest: sha256(JSON.stringify(unsigned)) };
  verifySkillStarterPack(pack, { packId: PACK_ID, packVersion: PACK_VERSION });
  return pack;
}

function isCliEntry(): boolean {
  return process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isCliEntry()) {
  try {
    const pack = buildWorkProductPack();
    const outDir = resolve(DEFAULT_ROOT, "..", "starter-packs", PACK_ID);
    mkdirSync(outDir, { recursive: true });
    const outFile = resolve(outDir, `${PACK_VERSION}.json`);
    writeFileSync(outFile, `${JSON.stringify(pack, null, 2)}\n`);
    console.log(`work-product pack 构建成功：${pack.skills.length} 个 Skill → ${relative(process.cwd(), outFile)}（packDigest ${pack.packDigest.slice(0, 12)}…）`);
  } catch (error) {
    if (error instanceof WorkContentPackBuildError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }
}
