#!/usr/bin/env node
/**
 * lint-skill-metadata-source.mjs —— 标准 skill 元数据「SKILL.md frontmatter 单源」门控
 *
 * 管的是什么：一个标准 skill 的 stable_name / version / capability_id 曾经写在两处——
 *   ① `skills/<pack>/<skill>/SKILL.md` 的 frontmatter
 *   ② `skills/<pack>/scripts/build.ts` 的 `stableName` / `semanticVersion` /
 *      `manifest.capabilityId`
 * 16 个标准 skill 里 9 个两处都写、7 个只写 `name`，没有任何脚本比对过。
 * issue #3154 把它收敛成**一处**：frontmatter 权威，`build.ts` 从
 * `apps/api/src/domain/skill/skill-frontmatter.ts` 的 `parseSkillFrontmatter` 里读。
 *
 * ⚠ 收敛之后，旧版判定①「两处逐字相等」退化为恒真——产物里的值本来就是从 frontmatter
 *   读出来的，比对它等于拿一个量跟它自己比。一道不再有判别力的绿灯比没有门更坏，
 *   所以那条判定连同它的测试一起删掉了（issue #3154 正文明确要求）。本脚本改成钉
 *   **第二份副本不许重新长出来**——这才是收敛之后唯一还会变红的东西。
 *
 * ── 判定四条 ─────────────────────────────────────────────────────────
 *  ① **build.ts 不许自己写这三个字段的值**。每个 `stableName:` / `semanticVersion:` /
 *     `capabilityId:` 的右值都必须是 `<某个变量>.<同名字段>`（即从 frontmatter 读出来的
 *     那个对象），字面量、三元表达式、由字面量表解构出来的变量、`{capabilityId}` 简写
 *     一律判红。判据用**全称计数**：剥掉注释与字符串后，这个标识符在源码里出现的总次数
 *     必须正好等于合规写法的两倍——只匹配"有没有违规形态"会漏掉没想到的第三种写法。
 *  ② **build.ts 必须真的 import 并调用 `parseSkillFrontmatter`**。没有这条，判定① 在一个
 *     根本不读 frontmatter 的脚本上平凡为真（本仓九次"全绿但空转"的同一形态）。
 *  ③ **每个 SKILL.md 都必须能被那个单源解析器解出三字段**，且 `name` 与目录名逐字相等。
 *     解析器抛什么，这里就红什么——判据和构建用的是同一段代码，不是第二份规则副本。
 *  ④ **形态只许收敛，不许扩散**（#3154 待决点 ①的裁决）：新增一律顶层写
 *     `version:` / `capability_id:`；历史上把它们嵌在 `metadata:` 下的 5 个**已发货**
 *     skill 逐条记在 `LEGACY_NESTED_METADATA` 里，**只减不增**：
 *       · 不在名单里的嵌套写法 ⇒ 红；
 *       · 名单里的条目改成顶层了却没删掉 ⇒ 也红（陈旧条目会让上限变成移动靶）。
 *     为什么不在本次一起改掉那 5 个：改它们等于改**已发货正文**，要连带 packVersion 与
 *     semanticVersion 双升、`standard-web` 那条钉 5439 字节的真实 Postgres 断言一起改。
 *     那是发货内容决策（见 `lint-shipped-pack-version.mjs`：「往哪边收是发货内容决策，
 *     归人类」），不该混进一次重构；名单保证它只会变少。
 *
 * ── 空集防线（本仓九次「全绿但空转」的教训）─────────────────────────
 *  · 一个 build.ts 都没扫到 / 一个 SKILL.md 都没扫到 ⇒ 一律红，拒绝下判断。
 *
 * 用法：pnpm exec tsx .harness/scripts/lint-skill-metadata-source.mjs
 *   （用 tsx 跑是因为判定③ 直接 import TypeScript 写的那个单源解析器——
 *     在这里重写一份 frontmatter 解析规则就又是同一事实的第二处声明。）
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSkillFrontmatter } from "../../apps/api/src/domain/skill/skill-frontmatter";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SKILLS_DIR = join(ROOT, "skills");

/** 这三个字段的值只许从 frontmatter 来。 */
export const SINGLE_SOURCE_FIELDS = ["stableName", "semanticVersion", "capabilityId"];

/**
 * 历史遗留：把 `version` / `capability_id` 嵌在 `metadata:` 下一层的已发货 skill。
 * 2026-09-21 实测的 5 条。**只减不增**——改成顶层就从这里删一行。
 */
export const LEGACY_NESTED_METADATA = [
  "standard-authoring/skill-authoring",
  "standard-document/document-understanding",
  "standard-visual/visual-content",
  "standard-web/web-artifact",
  "standard-web/web-research",
];

/**
 * 剥掉注释与字符串字面量后的源码。
 * 注释里提到字段名、URL 里带 `//`,都不该影响「这个标识符被声明了几次」的计数。
 */
export function stripCommentsAndStrings(source) {
  let out = "";
  for (let i = 0; i < source.length; i += 1) {
    const two = source.slice(i, i + 2);
    if (two === "//") { while (i < source.length && source[i] !== "\n") i += 1; out += "\n"; continue; }
    if (two === "/*") { i += 2; while (i < source.length && source.slice(i, i + 2) !== "*/") i += 1; i += 1; continue; }
    const ch = source[i];
    if (ch === "'" || ch === '"' || ch === "`") {
      const quote = ch; i += 1;
      while (i < source.length && source[i] !== quote) i += source[i] === "\\" ? 2 : 1;
      out += '""';
      continue;
    }
    out += ch;
  }
  return out;
}

/** 单个 build.ts 的判定材料：违规字段 + 是否真的接上了单源解析器。 */
export function inspectBuildScript(source) {
  const code = stripCommentsAndStrings(source);
  const offending = [];
  for (const field of SINGLE_SOURCE_FIELDS) {
    const total = (code.match(new RegExp(`\\b${field}\\b`, "g")) ?? []).length;
    const conforming = (code.match(new RegExp(`\\b${field}\\s*:\\s*[A-Za-z_$][\\w$]*(?:\\.[A-Za-z_$][\\w$]*)*\\.${field}\\b`, "g")) ?? []).length;
    if (total !== conforming * 2) offending.push({ field, total, conforming });
  }
  return {
    offending,
    importsReader: /import\s*\{[^}]*\bparseSkillFrontmatter\b[^}]*\}\s*from\s*['"][^'"]*domain\/skill\/skill-frontmatter['"]/.test(source),
    callsReader: /\bparseSkillFrontmatter\s*\(/.test(code),
  };
}

/** 纯函数判定。builds / skills 都是已经解析好的材料，便于 fixture 反证。 */
export function checkSkillMetadataSource(builds, skills, legacyNested, loadErrors = []) {
  const failures = [...loadErrors];
  if (builds.length === 0) failures.push("空集防线：`skills/*/scripts/build.ts` 一个都没扫到——包目录结构可能变了，拒绝判绿");
  if (skills.length === 0) failures.push("空集防线：一个 SKILL.md 都没扫到——包目录结构可能变了，拒绝判绿");

  for (const build of builds) {
    for (const { field, total, conforming } of build.offending) {
      failures.push(
        `${build.sourceFile}: ${field} 在构建脚本里出现 ${total} 次，其中只有 ${conforming} 处是 \`${field}: <frontmatter>.${field}\`` +
          ` —— 这三个字段的单源是 SKILL.md frontmatter，build.ts 不许再手写一份`,
      );
    }
    if (!build.importsReader) {
      failures.push(`${build.sourceFile}: 没有 import domain/skill/skill-frontmatter 的 parseSkillFrontmatter——判定① 在不读 frontmatter 的脚本上会平凡为真`);
    } else if (!build.callsReader) {
      failures.push(`${build.sourceFile}: import 了 parseSkillFrontmatter 却没调用它`);
    }
  }

  const allowlist = new Set(legacyNested);
  const stillNested = new Set();
  for (const skill of skills) {
    if (skill.error !== null) { failures.push(`${skill.key}: ${skill.error}`); continue; }
    if (!skill.nestedMetadata) continue;
    stillNested.add(skill.key);
    if (!allowlist.has(skill.key)) {
      failures.push(`${skill.key}: version / capability_id 嵌在 metadata: 下——新增一律顶层写，嵌套名单只减不增`);
    }
  }
  for (const key of legacyNested) {
    if (!skills.some((s) => s.key === key)) failures.push(`嵌套名单里的 ${key} 在仓库里找不到——名单陈旧，删掉这一行`);
    else if (!stillNested.has(key)) failures.push(`${key} 已经改成顶层写法，但还留在 LEGACY_NESTED_METADATA 名单里——名单只减不增，删掉这一行`);
  }

  return { ok: failures.length === 0, failures, builds: builds.length, skills: skills.length, nested: stillNested.size };
}

export function loadRecords() {
  const builds = [];
  const skills = [];
  const loadErrors = [];
  if (!existsSync(SKILLS_DIR)) return { builds, skills, loadErrors: ["skills/ 目录不存在"] };
  for (const pack of readdirSync(SKILLS_DIR).sort()) {
    if (pack === "starter-packs") continue;
    const packDir = join(SKILLS_DIR, pack);
    const buildPath = join(packDir, "scripts", "build.ts");
    if (!existsSync(buildPath)) continue;
    builds.push({ ...inspectBuildScript(readFileSync(buildPath, "utf8")), sourceFile: `skills/${pack}/scripts/build.ts` });
    for (const entry of readdirSync(packDir).sort()) {
      const skillDir = join(packDir, entry);
      if (!statSync(skillDir).isDirectory()) continue;
      const markdown = join(skillDir, "SKILL.md");
      if (!existsSync(markdown)) continue;
      const key = `${pack}/${entry}`;
      try {
        const meta = parseSkillFrontmatter(readFileSync(markdown, "utf8"), entry);
        skills.push({ key, error: null, nestedMetadata: meta.nestedMetadata });
      } catch (error) {
        // 解析器的报错自带 `<目录名>: ` 前缀，而这里还要再冠一个 `<pack>/<目录名>: `——
        // 剥掉它，免得同一个目录名在一行里出现两遍。
        const message = error instanceof Error ? error.message : String(error);
        skills.push({ key, error: message.startsWith(`${entry}: `) ? message.slice(entry.length + 2) : message, nestedMetadata: false });
      }
    }
  }
  return { builds, skills, loadErrors };
}

export function run() {
  const { builds, skills, loadErrors } = loadRecords();
  return checkSkillMetadataSource(builds, skills, LEGACY_NESTED_METADATA, loadErrors);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = run();
  if (result.ok) {
    console.log(`✅ [skill-metadata-source] ${result.builds} 个构建脚本零手写元数据，${result.skills} 个 SKILL.md frontmatter 是唯一来源；metadata: 嵌套遗留 ${result.nested} 条（只减不增）`);
    process.exit(0);
  }
  console.error("❌ [skill-metadata-source]");
  for (const f of result.failures) console.error(`   · ${f}`);
  process.exit(1);
}
