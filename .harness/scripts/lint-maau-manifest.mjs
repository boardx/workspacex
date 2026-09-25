#!/usr/bin/env node
/**
 * lint-maau-manifest.mjs —— 技能包清单完整性门控。
 *
 * （文件名保留旧叫法：标识符允许滞后于叫法，见 PROJECT.md「词汇单一事实源」。）
 *
 * ## 为什么要有这一道
 *
 * 商业边界要回答的第一个问题是：**这一个技能包是开源的还是付费内容。**
 * 回答它需要清单里同时有**身份**（是谁、哪一版）和**许可**（凭什么用）。
 *
 * ## ⚠ 本门控曾经误报过一半（2026-09-24 更正，issue 见 git log）
 *
 * 初版自己写了一个 frontmatter 解析器，**只认顶层 `key: value`**。而仓库里有 5 个已发货的
 * 官方技能包把 `capability_id` / `version` 嵌在 `metadata:` 下一层——那是
 * `apps/api/src/domain/skill/skill-frontmatter.ts` 明文承认的历史写法，构建一直读得出来。
 * 结果初版报的 18 处问题里 **10 处是假的**，还据此得出一个错误结论写进了开源方案：
 * 「自研的有身份无许可、外来的有许可无身份，没有一个两样俱全」。
 *
 * 实际是：**18 个全都有身份**；缺的只有许可，共 8 处。
 *
 * 根因是本仓那条硬约束：**同一事实不得声明在两处**。「怎么读 skill 的身份字段」
 * 早就有唯一入口，本脚本另写了一份，第二份就漂了。修法是删掉第二份：
 * 身份字段一律经 `parseSkillFrontmatter` 读取，它抛错时才算缺失。
 *
 * ## 检查什么
 *
 *   ① 身份：`name` / `version` / `capability_id` 经 `parseSkillFrontmatter` 读取
 *      （顶层与 `metadata:` 两种写法都认；缺失、冲突、非 x.y.z、`name` 与目录名不一致都会抛）
 *   ② `description` 必填
 *   ③ `capability_id` 命名空间：官方 `WX-S<数字>`，第三方 `<vendor>-<id>`
 *   ④ 许可可判定：frontmatter 的 `license` 或同目录 LICENSE 文件至少有一个。
 *      补许可就是在执行 D1（许可证决策），所以这一项在 D1 定下之前补不了。
 *
 * ## 分级
 *
 * 默认只报告不阻断。`--strict` 下任何缺失即失败——接进 CI 时用 strict，并同时补齐存量。
 *
 * 用法（要经 tsx 跑，因为要 import TypeScript 写的唯一解析器）：
 *   pnpm run lint:maau-manifest
 *   pnpm exec tsx .harness/scripts/lint-maau-manifest.mjs --strict
 *   pnpm exec tsx .harness/scripts/lint-maau-manifest.mjs --json out.json
 *   pnpm exec tsx .harness/scripts/lint-maau-manifest.mjs --root <仓库根>   # 测试用
 */
import { readFileSync, existsSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { parseSkillFrontmatter } from "../../apps/api/src/domain/skill/skill-frontmatter.ts";

const argRoot = process.argv.indexOf("--root");
const ROOT = argRoot > -1
  ? resolve(process.argv[argRoot + 1])
  : join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SKILLS = join(ROOT, "skills");
const LICENSE_FILES = ["LICENSE", "LICENSE.txt", "LICENSE.md"];
/** 官方命名空间，或 `<vendor>-<id>` 形式的第三方命名空间。 */
const CAPABILITY_ID = /^(WX-S\d+|[a-z][a-z0-9]*-[A-Za-z0-9._-]+)$/;

/** 递归找出每个 SKILL.md —— 一个 SKILL.md 就是一个技能包。 */
function findSkillFiles(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) findSkillFiles(p, out);
    else if (entry === "SKILL.md") out.push(p);
  }
  return out;
}

/**
 * 只取 description / license 这两个**不归唯一解析器管**的顶层标量。
 * 身份字段（name / version / capability_id）不在这里读——见文件头「误报过一半」。
 */
function topLevelScalar(text, key) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return null;
  const line = m[1].split(/\r?\n/).find((l) => l.startsWith(`${key}:`));
  return line ? line.slice(key.length + 1).trim() || null : null;
}

const files = findSkillFiles(SKILLS);
const findings = [];

for (const file of files) {
  const dir = dirname(file);
  const id = relative(SKILLS, dir);
  const text = readFileSync(file, "utf8");

  let identity = null;
  try {
    identity = parseSkillFrontmatter(text, basename(dir));
  } catch (e) {
    findings.push({ skill: id, rule: "identity", detail: String(e.message ?? e).replace(/^[^:]*:\s*/, "") });
  }
  if (!topLevelScalar(text, "description")) {
    findings.push({ skill: id, rule: "required", detail: "缺 description" });
  }
  if (identity && !CAPABILITY_ID.test(identity.capabilityId)) {
    findings.push({ skill: id, rule: "namespace", detail: `capability_id "${identity.capabilityId}" 不符合命名空间` });
  }
  const hasLicenseFile = LICENSE_FILES.some((n) => existsSync(join(dir, n)));
  if (!topLevelScalar(text, "license") && !hasLicenseFile) {
    findings.push({ skill: id, rule: "license", detail: "既无 license 字段也无 LICENSE 文件，无法判定开源还是付费内容" });
  }
}

const strict = process.argv.includes("--strict");
const jsonIdx = process.argv.indexOf("--json");
if (jsonIdx !== -1 && process.argv[jsonIdx + 1]) {
  writeFileSync(process.argv[jsonIdx + 1],
    JSON.stringify({ generatedAt: new Date().toISOString(), total: files.length, findings }, null, 2));
}

const affected = new Set(findings.map((f) => f.skill));
console.log(`技能包清单检查：${files.length} 个技能包，${affected.size} 个有问题，共 ${findings.length} 处`);

if (findings.length) {
  const byRule = new Map();
  for (const f of findings) byRule.set(f.rule, (byRule.get(f.rule) ?? 0) + 1);
  console.log("\n按规则：");
  for (const [rule, n] of [...byRule].sort((a, b) => b[1] - a[1])) console.log(`  ${rule.padEnd(12)} ${n}`);
  console.log("\n明细：");
  for (const f of findings) console.log(`  ${f.skill.padEnd(44)} ${f.detail}`);
}

if (!findings.length) {
  console.log("✅ 每个技能包都能机械回答「是谁、哪一版、凭什么用」");
} else if (strict) {
  console.error("\nstrict：清单不完整，未通过。");
  process.exit(1);
} else {
  console.log("\n（默认不阻断。接 CI 时用 --strict，并同时补齐存量——长期黄着的门控等于没有。）");
}
