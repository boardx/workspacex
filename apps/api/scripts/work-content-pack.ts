/**
 * work-content-pack.ts —— Work Skill 内容线 starter-pack 的**唯一**构建实现
 * （Phase 20 CT01 研究线 / CT04 产品线 / CT07 销售线共用；05-content-lines.md R3、E1）。
 *
 * 各条内容线的 `build-work-<line>-skill-pack.ts` 只声明 packId / 扫描根 / 期望覆盖集合，
 * 解析、校验、digest 与落盘逻辑都在这里——一处实现，不再按内容线复制。
 *
 * 为什么不放在 `skills/<pack>/scripts/build.ts`：`lint-shipped-pack-version.mjs` 把那个路径
 * 形态当作「标准平台包」（每个新组织自动 seed）；Work Skill pack（ADR-117）经 WS02
 * `/admin/skills/starter-pack-imports` 由平台运营显式导入，是另一条治理路径。
 *
 * E1 校验（任一失败 ⇒ 抛 `WorkContentPackBuildError`，携带全部问题，不写出任何文件）：
 *   1. frontmatter / `metadata.work` 缺失或不合法（`parseWorkSkillManifest`，WS01 单源）；
 *   2. `metadata.work.stableId` 不是 `WORK-STACK-320-LIST.md` 第一阶段中「✅ 通过」的实体；
 *   3. 包内 stableId 集合 ≠ 该内容线声明的覆盖集合（缺失 / 多出 / 重复）；
 *   4. `--check`：已提交的 `skills/starter-packs/<packId>/<ver>.json` 与源重建结果字节不符（digest 不符）。
 */
import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { sha256, verifySkillStarterPack, type SkillStarterPack } from "../src/domain/skill/starter-pack";
import { parseSkillFrontmatter } from "../src/domain/skill/skill-frontmatter";
import {
  parseWorkSkillManifest,
  formatWorkSkillManifestIssue,
  type WorkSkillManifestIssue,
} from "../src/domain/skill/work-skill-manifest";

/** repo-root-relative 320 实体清单（PASS 状态的单一事实源）。 */
export const DEFAULT_ENTITY_LIST = resolve(dirname(fileURLToPath(import.meta.url)), "../../../requirements/work-stack-v2/WORK-STACK-320-LIST.md");

export interface WorkContentPackSpec {
  readonly packId: string;
  readonly packVersion: string;
  /** 扫描根：`skills/<packId>/`。 */
  readonly root: string;
  /** 该内容线必须恰好覆盖的 v2 实体 ID 集合（05-content-lines.md R3）。 */
  readonly expectedStableIds: readonly string[];
  /** PASS 清单路径；测试可指向夹具。 */
  readonly entityListPath?: string;
}

export class WorkContentPackBuildError extends Error {
  constructor(readonly packId: string, readonly issues: readonly WorkSkillManifestIssue[]) {
    super(
      `${packId} pack 构建失败——${issues.length} 处问题，未写出任何文件：\n` +
        issues.map(formatWorkSkillManifestIssue).join("\n"),
    );
  }
}

/**
 * 读 `WORK-STACK-320-LIST.md` 第一阶段一节中状态为「✅ 通过」的实体 ID。
 * 只认第一阶段：后续阶段的实体即便已登记，也不在 Phase 20 可发布范围内。
 */
export function readPhaseOnePassIds(listPath: string = DEFAULT_ENTITY_LIST): Set<string> {
  const text = readFileSync(listPath, "utf8");
  const start = text.indexOf("## 第一阶段");
  if (start < 0) throw new Error(`${listPath}: 找不到「## 第一阶段」一节`);
  const next = text.indexOf("\n## ", start + 1);
  const section = text.slice(start, next < 0 ? undefined : next);
  const ids = new Set<string>();
  for (const m of section.matchAll(/^\|\s*✅\s*通过\s*\|\s*([SWD]\d{3})\s*\|/gm)) ids.add(m[1]!);
  return ids;
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

/** 构建内容线 pack（纯函数：只读 fs，不写）。 */
export function buildWorkContentPack(spec: WorkContentPackSpec): SkillStarterPack {
  const { packId, packVersion, root } = spec;
  const passIds = readPhaseOnePassIds(spec.entityListPath);
  const issues: WorkSkillManifestIssue[] = [];
  const skills: SkillStarterPack["skills"] = [];
  const seen = new Map<string, string>();

  for (const directory of listSkillDirectories(root)) {
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
      issues.push({ file: skillMdRelative, fieldPath: "metadata.work", message: `${packId} 包内的 SKILL.md 必须带 metadata.work（v2 实体 ID）` });
      continue;
    }
    if (work.kind === "invalid") {
      issues.push(...work.issues);
      continue;
    }

    const stableId = work.manifest.stableId;
    if (!passIds.has(stableId)) {
      issues.push({ file: skillMdRelative, fieldPath: "metadata.work.stableId", message: `${stableId} 不是 WORK-STACK-320-LIST.md 第一阶段中已通过（PASS）的实体` });
      continue;
    }
    const prior = seen.get(stableId);
    if (prior) {
      issues.push({ file: skillMdRelative, fieldPath: "metadata.work.stableId", message: `${stableId} 与 ${prior} 重复` });
      continue;
    }
    seen.set(stableId, skillMdRelative);

    const files = listSkillFiles(skillDir).map((path) => {
      const bytes = readFileSync(resolve(skillDir, path));
      return { path, mediaType: mediaTypeFor(path), digest: sha256(bytes), contentBase64: bytes.toString("base64") };
    });

    skills.push({
      stableName: frontmatter.stableName,
      name: stableId,
      semanticVersion: frontmatter.semanticVersion,
      manifest: { capabilityId: frontmatter.capabilityId, work: work.manifest },
      files,
    });
  }

  if (issues.length === 0) {
    const expected = new Set(spec.expectedStableIds);
    for (const id of [...expected].sort()) {
      if (!seen.has(id)) issues.push({ file: `${packId}/`, fieldPath: "coverage", message: `缺少覆盖集合中的实体 ${id}` });
    }
    for (const [id, file] of seen) {
      if (!expected.has(id)) issues.push({ file, fieldPath: "coverage", message: `${id} 不在 ${packId} 的覆盖集合中` });
    }
  }

  if (issues.length > 0) throw new WorkContentPackBuildError(packId, issues);

  const unsigned = { schemaVersion: 1 as const, packId, packVersion, skills };
  const pack: SkillStarterPack = { ...unsigned, packDigest: sha256(JSON.stringify(unsigned)) };
  verifySkillStarterPack(pack, { packId, packVersion });
  return pack;
}

export function serializePack(pack: SkillStarterPack): string {
  return `${JSON.stringify(pack, null, 2)}\n`;
}

export function committedPackPath(spec: Pick<WorkContentPackSpec, "root" | "packId" | "packVersion">): string {
  return resolve(spec.root, "..", "starter-packs", spec.packId, `${spec.packVersion}.json`);
}

/**
 * E1「digest 不符」：已提交的 pack JSON 必须与源重建结果字节一致。
 * 返回问题列表（空 = 一致）。
 */
export function checkCommittedPack(spec: WorkContentPackSpec, committedFile: string = committedPackPath(spec)): WorkSkillManifestIssue[] {
  const rebuilt = buildWorkContentPack(spec);
  const label = relative(resolve(spec.root, ".."), committedFile);
  if (!existsSync(committedFile)) {
    return [{ file: label, fieldPath: "packDigest", message: "已提交的 pack 文件不存在，请运行构建脚本" }];
  }
  const committedText = readFileSync(committedFile, "utf8");
  if (committedText === serializePack(rebuilt)) return [];
  let committedDigest = "（无法解析）";
  try {
    committedDigest = String((JSON.parse(committedText) as { packDigest?: unknown }).packDigest);
  } catch { /* keep placeholder */ }
  return [{
    file: label,
    fieldPath: "packDigest",
    message: `digest 不符：已提交 ${committedDigest.slice(0, 12)}…，源重建 ${rebuilt.packDigest.slice(0, 12)}…——请重新运行构建脚本`,
  }];
}

/** 各内容线脚本的 CLI 入口：默认构建并写出；`--check` 只核对已提交产物。 */
export function runWorkContentPackCli(spec: WorkContentPackSpec, argv: readonly string[] = process.argv.slice(2)): void {
  try {
    if (argv.includes("--check")) {
      const issues = checkCommittedPack(spec);
      if (issues.length > 0) throw new WorkContentPackBuildError(spec.packId, issues);
      console.log(`${spec.packId} pack 与源一致。`);
      return;
    }
    const pack = buildWorkContentPack(spec);
    const outFile = committedPackPath(spec);
    mkdirSync(resolve(outFile, ".."), { recursive: true });
    writeFileSync(outFile, serializePack(pack));
    console.log(`${spec.packId} pack 构建成功：${pack.skills.length} 个 Skill → ${relative(process.cwd(), outFile)}（packDigest ${pack.packDigest.slice(0, 12)}…）`);
  } catch (error) {
    if (error instanceof WorkContentPackBuildError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }
}
