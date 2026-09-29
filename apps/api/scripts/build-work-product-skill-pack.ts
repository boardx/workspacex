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
 * （Persona/Journey facilitation、HMW framing、Prototype planning）以 `skillGaps` 登记在
 * `skills/work-product/role-skill-gaps.json`（角色包的 skillGaps 值，domain.md「本束只填白名单与
 * skillGaps 值」；agent-role 契约字段落点仍是 usecases.md Q4），构建逐字核对它与组合矩阵 D011 行
 * 一致，且任何 gap 都不许被一个 Skill 冒名顶替（R6，不造新 Skill）。
 *
 * E1（R4）三条拒绝路径全部在**构建**里判，不在测试里判：
 *   - 缺 v2 ID / 多出 / 重复：产出的 stableId 集合必须恰为 `expectedStableIds()`（D003 ∪ D011 行取自
 *     组合矩阵本身 ∪ R3.5 额外依赖），否则整包拒绝——不生成半个 pack；
 *   - 引用未 PASS 实体：每个 stableId（以及角色包引用的 D003/D011）都必须有
 *     `requirements/work-stack-v2/reviews/<ID>.review.md` 且首个 `Verdict:` 为 PASS；
 *   - digest 不符：若已发布同版本产物（`skills/starter-packs/work-product/<semver>.json`），先按导入
 *     端同一份 `verifySkillStarterPack` 核验它自身每个文件 digest 与 packDigest，再要求与本次构建
 *     packDigest 相等——已发布版本不可变，内容变了就必须升版本。
 *
 * `buildWorkProductPack(root)` 是纯函数（只读 fs，不写），CLI 入口另起一段负责落盘——
 * 这样测试能对一份临时目录（例如篡改过某个 SKILL.md 的拷贝）跑同一份构建逻辑，
 * 不必依赖真实仓库内容，也不会把测试夹具误写回仓库。
 */
import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { sha256, verifySkillStarterPack, type SkillStarterPack } from "../src/domain/skill/starter-pack";
import { checkWorkSkillManifests } from "../src/domain/skill/work-skill-import-check";
import { parseSkillFrontmatter } from "../src/domain/skill/skill-frontmatter";
import {
  parseWorkSkillManifest,
  formatWorkSkillManifestIssue,
  type WorkSkillManifestIssue,
} from "../src/domain/skill/work-skill-manifest";

export const PACK_ID = "work-product";
export const PACK_VERSION = "1.0.0";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../..");
/** repo-root-relative `skills/work-product/` (this file lives at `apps/api/scripts/`). */
export const DEFAULT_ROOT = resolve(REPO_ROOT, "skills/work-product");
export const DEFAULT_OUT_ROOT = resolve(REPO_ROOT, "skills/starter-packs");
export const DEFAULT_V2_ROOT = resolve(REPO_ROOT, "requirements/work-stack-v2");
export const SKILL_GAPS_FILE = "role-skill-gaps.json";

/** 产品线角色包覆盖的 DigitalHuman（组合矩阵行）。 */
export const PRODUCT_ROLES = ["D003", "D011"] as const;
/** R3 步骤 5 列出的 W030/W031/W032/W002 额外依赖（05-content-lines.md，唯一出处）。 */
export const EXTRA_DEPENDENCIES = ["S070", "S142", "S076", "S157", "S161", "S074", "S155", "S006", "S017", "S007", "S162"] as const;

export type BuildIssue = WorkSkillManifestIssue;

export class WorkContentPackBuildError extends Error {
  constructor(readonly issues: readonly BuildIssue[]) {
    super(
      `work-product pack 构建失败——${issues.length} 处问题，未写出任何文件：\n` +
        issues.map(formatWorkSkillManifestIssue).join("\n"),
    );
  }
}

export interface BuildOptions {
  readonly root?: string;
  /** `requirements/work-stack-v2`（组合矩阵 + reviews/）。 */
  readonly v2Root?: string;
  /** 已发布产物根（`skills/starter-packs`）；同版本产物存在即做 digest 一致性核对。 */
  readonly outRoot?: string;
}

export interface WorkProductBuild {
  readonly pack: SkillStarterPack;
  readonly skillGaps: Readonly<Record<string, readonly string[]>>;
}

type MatrixRow = { readonly skills: readonly string[]; readonly skillGaps: readonly string[] };

const MATRIX_FILE = "DIGITALHUMAN-COMPOSITION-MATRIX.md";

function splitList(cell: string): string[] {
  const trimmed = cell.trim();
  if (trimmed === "" || trimmed === "—" || trimmed === "-") return [];
  return trimmed.split(/[;,]/).map((part) => part.trim()).filter(Boolean);
}

/** 读组合矩阵中某个 DigitalHuman 行：`| ID | Name | Workflows | Skills | Skill gaps |`。 */
export function readCompositionRow(v2Root: string, roleId: string): MatrixRow | null {
  const text = readFileSync(resolve(v2Root, MATRIX_FILE), "utf8");
  for (const line of text.split("\n")) {
    const cells = line.split("|").slice(1, -1);
    if (cells.length >= 5 && cells[0]!.trim() === roleId) {
      return { skills: splitList(cells[3]!), skillGaps: splitList(cells[4]!) };
    }
  }
  return null;
}

/** 期望 stableId 集合：D003 ∪ D011（取自组合矩阵）∪ 额外依赖，排序去重。 */
export function expectedStableIds(v2Root: string = DEFAULT_V2_ROOT): string[] {
  const ids = new Set<string>(EXTRA_DEPENDENCIES);
  for (const role of PRODUCT_ROLES) {
    const row = readCompositionRow(v2Root, role);
    if (!row) throw new WorkContentPackBuildError([{ file: MATRIX_FILE, fieldPath: role, message: "组合矩阵缺少该 DigitalHuman 行" }]);
    for (const id of row.skills) ids.add(id);
  }
  return [...ids].sort();
}

/** 实体评审结论：`reviews/<ID>.review.md` 首个 `Verdict:` 行；缺文件 → null。 */
export function reviewVerdict(v2Root: string, entityId: string): string | null {
  const path = resolve(v2Root, "reviews", `${entityId}.review.md`);
  if (!existsSync(path)) return null;
  const match = /^Verdict:\s*(\S+)/m.exec(readFileSync(path, "utf8"));
  return match ? match[1]! : "";
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

function checkSkillGaps(root: string, v2Root: string, skillNames: ReadonlySet<string>, issues: BuildIssue[]): Record<string, string[]> {
  const path = resolve(root, SKILL_GAPS_FILE);
  if (!existsSync(path)) {
    issues.push({ file: SKILL_GAPS_FILE, fieldPath: "skillGaps", message: "缺少角色包 skillGaps 登记文件" });
    return {};
  }
  let declared: Record<string, unknown>;
  try {
    declared = (JSON.parse(readFileSync(path, "utf8")) as { skillGaps?: Record<string, unknown> }).skillGaps ?? {};
  } catch {
    issues.push({ file: SKILL_GAPS_FILE, fieldPath: "skillGaps", message: "不是合法 JSON" });
    return {};
  }
  const out: Record<string, string[]> = {};
  for (const role of PRODUCT_ROLES) {
    const expected = readCompositionRow(v2Root, role)?.skillGaps ?? [];
    const got = declared[role] ?? [];
    const gotList = Array.isArray(got) ? got.map(String) : [];
    if (JSON.stringify(gotList) !== JSON.stringify(expected)) {
      issues.push({ file: SKILL_GAPS_FILE, fieldPath: `skillGaps.${role}`, message: `必须逐字等于组合矩阵 ${role} 行 [${expected.join("; ")}]，实际 [${gotList.join("; ")}]` });
    }
    for (const gap of gotList) {
      if (skillNames.has(gap.toLocaleLowerCase())) {
        issues.push({ file: SKILL_GAPS_FILE, fieldPath: `skillGaps.${role}`, message: `skillGap「${gap}」被一个 Skill 冒名实现——R6 只登记不造新 Skill` });
      }
    }
    if (gotList.length > 0) out[role] = gotList;
  }
  for (const role of Object.keys(declared)) {
    if (!(PRODUCT_ROLES as readonly string[]).includes(role)) {
      issues.push({ file: SKILL_GAPS_FILE, fieldPath: `skillGaps.${role}`, message: "不属于产品线角色包" });
    }
  }
  return out;
}

/**
 * 构建 work-product 包（纯函数：只读文件，不写任何输出）。任一 E1 问题 ⇒ 抛
 * `WorkContentPackBuildError`，携带全部问题（逐条指名文件/实体 ID 与字段）。
 */
export function buildWorkProductPack(options: BuildOptions | string = {}): WorkProductBuild {
  const opts: BuildOptions = typeof options === "string" ? { root: options } : options;
  const root = opts.root ?? DEFAULT_ROOT;
  const v2Root = opts.v2Root ?? DEFAULT_V2_ROOT;
  const outRoot = opts.outRoot ?? DEFAULT_OUT_ROOT;
  const directories = listSkillDirectories(root);
  const issues: BuildIssue[] = [];
  const skills: SkillStarterPack["skills"] = [];
  const seen = new Map<string, string>();

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
    const stableId = work.manifest.stableId;
    const previous = seen.get(stableId);
    if (previous) {
      issues.push({ file: skillMdRelative, fieldPath: "metadata.work.stableId", message: `${stableId} 与 ${previous} 重复` });
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

  // E1：缺 v2 ID / 多出 → 不生成半个 pack。
  const expected = expectedStableIds(v2Root);
  for (const id of expected) {
    if (!seen.has(id)) issues.push({ file: `${PACK_ID}/`, fieldPath: id, message: "缺少该 v2 实体的 SKILL.md（半个 pack 不许构建）" });
  }
  for (const [id, file] of seen) {
    if (!expected.includes(id)) issues.push({ file, fieldPath: "metadata.work.stableId", message: `${id} 不在产品线期望集合（D003 ∪ D011 ∪ 额外依赖）内` });
  }

  // E1：引用未 PASS 实体（Skill 本身 + 角色包引用的 DigitalHuman）。
  for (const id of [...seen.keys(), ...PRODUCT_ROLES]) {
    const verdict = reviewVerdict(v2Root, id);
    if (verdict !== "PASS") {
      issues.push({ file: seen.get(id) ?? SKILL_GAPS_FILE, fieldPath: id, message: `引用未 PASS 实体（reviews/${id}.review.md 结论 ${verdict ?? "缺失"}）` });
    }
  }

  const skillNames = new Set(skills.map((skill) => skill.stableName.toLocaleLowerCase()));
  const skillGaps = checkSkillGaps(root, v2Root, skillNames, issues);

  if (issues.length > 0) throw new WorkContentPackBuildError(issues);

  const unsigned = { schemaVersion: 1 as const, packId: PACK_ID, packVersion: PACK_VERSION, skills };
  const pack: SkillStarterPack = { ...unsigned, packDigest: sha256(JSON.stringify(unsigned)) };
  verifySkillStarterPack(pack, { packId: PACK_ID, packVersion: PACK_VERSION });
  // 导入端（WS02）同一份 metadata.work 校验：构建通过 ⇒ 导入不会因 manifest/能力分类被拒。
  const importCheck = checkWorkSkillManifests(pack);
  if (importCheck.kind === "rejected") throw new WorkContentPackBuildError(importCheck.issues);

  // E1：digest 不符——已发布同版本产物必须自洽（导入端同一核验）且与本次构建一致。
  const published = publishedPackPath(outRoot);
  if (existsSync(published)) {
    const file = relative(REPO_ROOT, published);
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(published, "utf8"));
      verifySkillStarterPack(raw, { packId: PACK_ID, packVersion: PACK_VERSION });
    } catch {
      throw new WorkContentPackBuildError([{ file, fieldPath: "digest", message: "已发布产物的文件 digest / packDigest 与内容不符（被篡改）" }]);
    }
    const declared = (raw as SkillStarterPack).packDigest;
    if (declared !== pack.packDigest) {
      throw new WorkContentPackBuildError([{ file, fieldPath: "packDigest", message: `已发布 ${PACK_VERSION} 声明 ${declared}，源构建得 ${pack.packDigest}——内容变了必须升 packVersion` }]);
    }
  }
  return { pack, skillGaps };
}

export function publishedPackPath(outRoot: string = DEFAULT_OUT_ROOT): string {
  return resolve(outRoot, PACK_ID, `${PACK_VERSION}.json`);
}

function isCliEntry(): boolean {
  return process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isCliEntry()) {
  try {
    // 环境变量只供测试指向临时拷贝；默认即仓库真实目录。
    const options: BuildOptions = {
      root: process.env.WORK_PRODUCT_PACK_ROOT ?? DEFAULT_ROOT,
      v2Root: process.env.WORK_PRODUCT_V2_ROOT ?? DEFAULT_V2_ROOT,
      outRoot: process.env.WORK_PRODUCT_PACK_OUT ?? DEFAULT_OUT_ROOT,
    };
    const { pack } = buildWorkProductPack(options);
    const outFile = publishedPackPath(options.outRoot);
    mkdirSync(dirname(outFile), { recursive: true });
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
