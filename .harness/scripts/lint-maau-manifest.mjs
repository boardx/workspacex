#!/usr/bin/env node
/**
 * lint-maau-manifest.mjs —— MAAU 清单完整性门控。
 *
 * ## 为什么要有这一道
 *
 * 商业边界要回答的第一个问题是：**这一个 MAAU 是开源的还是付费内容。**
 * 回答它需要清单里同时有**身份**（是谁、哪一版）和**许可**（凭什么用）。
 *
 * 2026-09-22 实测 18 个 skill，发现两半分裂在两批人身上：
 *   - 自研 skill（13 个）：有 `capability_id` 与 `version`，多数**没有** LICENSE；
 *   - 外来 skill（5 个）：有 LICENSE，**没有**身份字段。
 * 没有一个两样俱全。也就是说，今天没有任何一个 MAAU 能机械回答上面那个问题。
 *
 * 这正是本仓反复栽的那个形状：规范早就该有，但**没有脚本**，于是它不存在
 * （AGENTS.md「没有脚本的规范条目视为未落地」）。本脚本把它变成会红的东西。
 *
 * ## 检查什么
 *
 *   ① frontmatter 必填：name / description / capability_id / version
 *   ② `version` 必须是 SemVer
 *   ③ `capability_id` 命名空间：官方用 `WX-S<数字>`，第三方用 `<vendor>-<id>`
 *   ④ 许可可判定：frontmatter 的 `license` 或同目录 LICENSE 文件至少有一个；
 *      两个都有时不校验文本一致性（那是法务的事，不是 lint 的事）
 *
 * ## 分级
 *
 * 默认只报告不阻断（`warn`），因为存量缺口有 8 处，一上来就红会让所有人绕过它。
 * `--strict` 下任何缺失即失败——**接进 CI 时用 strict，并同时把存量补齐**，
 * 不要长期挂着一个永远黄着的门控，那等于没有。
 *
 * 用法：
 *   node .harness/scripts/lint-maau-manifest.mjs
 *   node .harness/scripts/lint-maau-manifest.mjs --strict
 *   node .harness/scripts/lint-maau-manifest.mjs --json out.json
 */
import { readFileSync, existsSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SKILLS = join(ROOT, "skills");
const REQUIRED = ["name", "description", "capability_id", "version"];
const LICENSE_FILES = ["LICENSE", "LICENSE.txt", "LICENSE.md"];
const SEMVER = /^\d+\.\d+\.\d+$/;
/** 官方命名空间，或 `<vendor>-<id>` 形式的第三方命名空间。 */
const CAPABILITY_ID = /^(WX-S\d+|[a-z][a-z0-9]*-[A-Za-z0-9._-]+)$/;

/** 递归找出每个 SKILL.md —— 一个 SKILL.md 就是一个 MAAU。 */
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
 * 取出 frontmatter 的顶层标量键。
 * 只认顶层 `key: value`，不解析嵌套——清单的必填字段全是标量，
 * 引一个 YAML 依赖进来会让本脚本也需要 install 才能跑。
 */
function frontmatterKeys(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return null;
  const keys = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_][A-Za-z0-9_]*):[ \t]*(.*)$/.exec(line);
    if (kv) keys[kv[1]] = kv[2].trim();
  }
  return keys;
}

const files = findSkillFiles(SKILLS);
const findings = [];

for (const file of files) {
  const dir = dirname(file);
  const id = relative(SKILLS, dir);
  const keys = frontmatterKeys(readFileSync(file, "utf8"));

  if (keys === null) {
    findings.push({ skill: id, rule: "frontmatter", detail: "没有 frontmatter" });
    continue;
  }
  for (const field of REQUIRED) {
    if (!keys[field]) findings.push({ skill: id, rule: "required", detail: `缺 ${field}` });
  }
  if (keys.version && !SEMVER.test(keys.version)) {
    findings.push({ skill: id, rule: "semver", detail: `version "${keys.version}" 不是 SemVer` });
  }
  if (keys.capability_id && !CAPABILITY_ID.test(keys.capability_id)) {
    findings.push({ skill: id, rule: "namespace", detail: `capability_id "${keys.capability_id}" 不符合命名空间` });
  }
  const hasLicenseFile = LICENSE_FILES.some((n) => existsSync(join(dir, n)));
  if (!keys.license && !hasLicenseFile) {
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
console.log(`MAAU 清单检查：${files.length} 个 MAAU，${affected.size} 个有问题，共 ${findings.length} 处`);

if (findings.length) {
  const byRule = new Map();
  for (const f of findings) byRule.set(f.rule, (byRule.get(f.rule) ?? 0) + 1);
  console.log("\n按规则：");
  for (const [rule, n] of [...byRule].sort((a, b) => b[1] - a[1])) console.log(`  ${rule.padEnd(12)} ${n}`);
  console.log("\n明细：");
  for (const f of findings) console.log(`  ${f.skill.padEnd(44)} ${f.detail}`);
}

if (!findings.length) {
  console.log("✅ 每个 MAAU 都能机械回答「是谁、哪一版、凭什么用」");
} else if (strict) {
  console.error("\nstrict：清单不完整，未通过。");
  process.exit(1);
} else {
  console.log("\n（默认不阻断。接 CI 时用 --strict，并同时补齐存量——长期黄着的门控等于没有。）");
}
