#!/usr/bin/env node
/**
 * lint-skill-metadata-source.mjs —— 标准 skill 元数据「两处手写」的钉现状门控
 *
 * 管的是什么：一个标准 skill 的 stable_name / version / capability_id 今天写在两处——
 *   ① `skills/<pack>/<skill>/SKILL.md` 的 frontmatter（`name` / `version` /
 *      `capability_id`，`standard-authoring` 用 `metadata:` 嵌一层）
 *   ② `skills/<pack>/scripts/build.ts` 的 `stableName` / `semanticVersion` /
 *      `manifest.capabilityId`
 * 15 个 skill 里 8 个两处都写、7 个只写一处（只写 `name`）。没有任何脚本比对过。
 *
 * 判据取自**构建产物** `skills/starter-packs/<pack>/<build.ts 的 packVersion>.json`
 * 而不是 regex 扫 build.ts：几个包的 semanticVersion 是三元表达式算出来的，
 * 正则扫源码扫不准，而扫不准的门控会向「绿」的方向错。产物 JSON 里既有构建侧
 * 三个字段，又内嵌了那一版 SKILL.md 的原始字节——**同一份材料里的两处声明**，
 * 逐字比对不需要任何推断。
 *
 * ── 判定两条 ─────────────────────────────────────────────────────────
 *  ① **两处都出现的字段必须逐字相等**。全称断言，对全部 skill 生效，无豁免。
 *  ② **约定必须一致**：SKILL.md frontmatter 三个字段必须齐。今天有 7 个只写
 *     `name`，它们逐条记在下方 `CONVENTION_DEBT` 里，**只减不增**：
 *       · 不在名单里的缺字段 ⇒ 红（新 skill 不许继续少写）；
 *       · 名单里的条目**补齐了却没从名单删掉** ⇒ 也红（陈旧条目会让债务上限变成
 *         移动靶，本仓吃过这个亏）。
 *     选 allowlist 而不是让它直接红的理由：一道永远红的门控会被 `--no-verify`
 *     绕过、被当成噪声，等于没有门；allowlist 把 7 条债务变成**会减少、不会增加**
 *     的可见清单，同时让判定①对全部 15 个 skill 立刻生效。
 *
 * ⚠ 本门控只钉现状。真正的收敛（SKILL.md frontmatter 作单源、build.ts 从中读）
 *   另案追踪，不在本脚本范围内。
 *
 * ── 空集防线（本仓九次「全绿但空转」的教训）─────────────────────────
 *  · 一个包都没扫到 / 某个包的产物清单不存在 / 某个 skill 的 SKILL.md 不在产物里
 *    ⇒ 一律红，拒绝下判断，不是「没对象所以全绿」。
 *
 * 用法：node .harness/scripts/lint-skill-metadata-source.mjs
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SKILLS_DIR = join(ROOT, "skills");

/**
 * 约定债务名单：SKILL.md frontmatter 少写 version / capability_id 的 skill。
 * 2026-09-09 实测的 7 条。**只减不增**——补齐一个就从这里删一行。
 */
export const CONVENTION_DEBT = [
  "standard-audio/audio-transcription",
  "standard-audio/meeting-minutes",
  "standard-canvas/diagram-and-canvas",
  "standard-context/internal-communications",
  "standard-context/knowledge-grounded-answer",
  "standard-context/meeting-preparation",
  "standard-context/project-status-report",
];

/** frontmatter 取值：支持顶层 `version:` 与 `metadata:` 下缩进一层两种写法。 */
export function readFrontmatter(markdown) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(markdown);
  if (m === null) return null;
  const body = m[1];
  const get = (key) => {
    const hit = new RegExp(`^\\s*${key}:\\s*(\\S.*?)\\s*$`, "m").exec(body);
    return hit === null ? null : hit[1].replace(/^['"]|['"]$/g, "");
  };
  return { name: get("name"), version: get("version"), capability_id: get("capability_id") };
}

const FIELDS = [
  { md: "name", built: "stableName", label: "stable_name" },
  { md: "version", built: "semanticVersion", label: "version" },
  { md: "capability_id", built: "capabilityId", label: "capability_id" },
];

/** 纯函数判定。records: {key, built:{stableName,semanticVersion,capabilityId}, frontmatter} */
export function checkSkillMetadata(records, debt, loadErrors = []) {
  const failures = [...loadErrors];
  if (records.length === 0) failures.push("空集防线：一个标准 skill 都没扫到——包目录结构可能变了，拒绝判绿");

  const debtSet = new Set(debt);
  const stillIncomplete = new Set();

  for (const r of records) {
    if (r.frontmatter === null) {
      failures.push(`${r.key}: SKILL.md 没有 frontmatter，取不到声明`);
      continue;
    }
    // ① 两处都出现的字段必须逐字相等——全称，无豁免
    for (const f of FIELDS) {
      const a = r.frontmatter[f.md];
      const b = r.built[f.built];
      if (a !== null && b !== undefined && b !== null && a !== b) {
        failures.push(`${r.key}: ${f.label} 两处不一致——SKILL.md frontmatter 写 "${a}"，build 产物写 "${b}"`);
      }
    }
    // ② 约定一致性
    const missing = FIELDS.filter((f) => r.frontmatter[f.md] === null).map((f) => f.label);
    if (missing.length > 0) {
      stillIncomplete.add(r.key);
      if (!debtSet.has(r.key)) {
        failures.push(`${r.key}: SKILL.md frontmatter 缺 ${missing.join(" / ")}——约定是三个字段都写，新增不许再少写`);
      }
    }
  }

  for (const key of debt) {
    if (!records.some((r) => r.key === key)) {
      failures.push(`债务名单里的 ${key} 在仓库里找不到——名单陈旧，删掉这一行`);
    } else if (!stillIncomplete.has(key)) {
      failures.push(`${key} 的 frontmatter 已补齐，但还留在 CONVENTION_DEBT 名单里——名单只减不增，删掉这一行`);
    }
  }

  return { ok: failures.length === 0, failures, checked: records.length, debt: stillIncomplete.size };
}

export function loadRecords() {
  const records = [];
  const loadErrors = [];
  if (!existsSync(SKILLS_DIR)) return { records, loadErrors: ["skills/ 目录不存在"] };
  for (const pack of readdirSync(SKILLS_DIR).sort()) {
    if (pack === "starter-packs") continue;
    const buildPath = join(SKILLS_DIR, pack, "scripts", "build.ts");
    if (!existsSync(buildPath)) continue;
    const version = /packVersion\s*:\s*['"]([^'"]+)['"]/.exec(readFileSync(buildPath, "utf8"))?.[1];
    if (version === undefined) {
      loadErrors.push(`${pack}: build.ts 里取不到 packVersion，拒绝下判断`);
      continue;
    }
    const manifest = join(SKILLS_DIR, "starter-packs", pack, `${version}.json`);
    if (!existsSync(manifest)) {
      loadErrors.push(`${pack}: 构建产物 skills/starter-packs/${pack}/${version}.json 不存在，拒绝下判断`);
      continue;
    }
    const parsed = JSON.parse(readFileSync(manifest, "utf8"));
    for (const skill of parsed.skills ?? []) {
      const file = (skill.files ?? []).find((f) => f.path === "SKILL.md");
      if (file === undefined) {
        loadErrors.push(`${pack}/${skill.stableName}: 构建产物里没有 SKILL.md 条目，拒绝下判断`);
        continue;
      }
      records.push({
        key: `${pack}/${skill.stableName}`,
        built: { stableName: skill.stableName, semanticVersion: skill.semanticVersion, capabilityId: skill.manifest?.capabilityId },
        frontmatter: readFrontmatter(Buffer.from(file.contentBase64, "base64").toString("utf8")),
      });
    }
  }
  return { records, loadErrors };
}

export function run() {
  const { records, loadErrors } = loadRecords();
  return checkSkillMetadata(records, CONVENTION_DEBT, loadErrors);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = run();
  if (result.ok) {
    console.log(`✅ [skill-metadata-source] ${result.checked} 个标准 skill 的两处元数据逐字一致；约定债务 ${result.debt} 条（只减不增）`);
    process.exit(0);
  }
  console.error("❌ [skill-metadata-source]");
  for (const f of result.failures) console.error(`   · ${f}`);
  process.exit(1);
}
