#!/usr/bin/env node
/**
 * lint-third-party-license.mjs —— 随产品分发的第三方依赖，许可证必须在允许清单内（#4262）。
 *
 * ## 与已有脚本的分工
 *
 *   - `lint-package-license.mjs`：**我们自己的**工作区包标什么许可证。
 *   - `oss-dependency-inventory.mjs`：盘点**别人的**包（lockfile + pnpm 存储），只陈述事实、不下判断。
 *   - 本脚本：拿盘点结果当输入，对「随产品分发」闭包里**本机已安装**的包下判断——
 *     许可证表达式按 SPDX 语义（OR 任选其一、AND 必须同时满足）落在允许清单内才放行；
 *     否则必须在「已审」清单里按 `名字@版本` **且许可证原文一致**登记过，许可证变了就重新变红。
 *
 * 开发依赖不随产品分发，不构成再分发义务，不在本门控范围（口径见
 * docs/research/oss-dependency-licenses-2026-09-24.md）。本机没装的平台专属包离线查不到许可证，
 * 只计数不判——要查它们，跑 `oss-dependency-inventory.mjs --registry`。
 *
 * 用法：
 *   node .harness/scripts/lint-third-party-license.mjs
 *   node .harness/scripts/lint-third-party-license.mjs --inventory <json> --policy <json> --reviewed <json>   # 测试用
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const arg = (f, d) => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : d; };
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

const policy = readJson(arg("--policy", join(ROOT, ".harness/state/third-party-license-policy.json")));
const reviewed = readJson(arg("--reviewed", join(ROOT, ".harness/state/third-party-license-reviewed.json"))).reviewed;

let inventory;
const invPath = arg("--inventory");
if (invPath) inventory = readJson(invPath);
else {
  const tmp = mkdtempSync(join(tmpdir(), "tp-license-"));
  try {
    execFileSync("node", [join(HERE, "oss-dependency-inventory.mjs"), "--json", join(tmp, "inv.json")], { cwd: ROOT, stdio: "ignore" });
    inventory = readJson(join(tmp, "inv.json"));
  } finally { rmSync(tmp, { recursive: true, force: true }); }
}
if (!inventory.nodeModulesPresent) { console.error("node_modules 不存在，读不到任何许可证——先 pnpm install。空集不是全绿。"); process.exit(1); }

const allow = new Set(policy.allow.map((s) => s.toLowerCase()));
const aliases = Object.fromEntries(Object.entries(policy.aliases ?? {}).map(([k, v]) => [k.toLowerCase(), v.toLowerCase()]));
const norm = (term) => { const t = term.replace(/\(LICENSE 文件\)$/, "").trim().toLowerCase(); return aliases[t] ?? t; };
/** SPDX：OR 任一选项全部可接受即可；AND 每一项都要可接受。括号只剥离（与 lib/spdx-review.mjs 同口径）。 */
export function allowed(expr) {
  const flat = expr.replace(/\(LICENSE 文件\)/g, "").replace(/[()]/g, " ").replace(/\s+/g, " ").trim();
  return flat.split(/ OR /i).some((alt) => alt.split(/ AND /i).every((t) => allow.has(norm(t))));
}

const reviewedKey = new Map(reviewed.map((r) => [r.package, r]));
const shipped = inventory.packages.filter((p) => p.shipped);
const notInstalled = shipped.filter((p) => !p.installed).length;
const findings = [];
let viaReview = 0;
const usedReviews = new Set();
for (const p of shipped.filter((q) => q.installed)) {
  const key = `${p.name}@${p.version}`;
  if (p.license && allowed(p.license)) continue;
  const r = reviewedKey.get(key);
  const lic = p.license ?? null;
  if (r && (r.license ?? null) === lic) { viaReview++; usedReviews.add(key); continue; }
  findings.push(r ? `${key}：已审登记的许可证是 ${JSON.stringify(r.license)}，现在是 ${JSON.stringify(lic)}——许可证变了，要重新审`
    : lic ? `${key}：许可证 "${lic}" 不在允许清单内，也没有在已审清单登记` : `${key}：未声明许可证，也没有在已审清单登记`);
}
const stale = reviewed.filter((r) => !usedReviews.has(r.package));

console.log(`第三方许可证门控：随产品分发 ${shipped.length} 个（已安装并判定 ${shipped.length - notInstalled} · 本机未装未判 ${notInstalled}），已审放行 ${viaReview}，问题 ${findings.length} 处`);
for (const s of stale) console.log(`  提示：已审条目 ${s.package} 已不在分发闭包里或已变为允许许可证，可删`);
if (shipped.length === 0) { console.error("随产品分发的包是 0 个——空集不是全绿。"); process.exit(1); }
if (findings.length) {
  for (const f of findings) console.error(`  ${f}`);
  console.error("\n处理：换掉这条依赖，或由人审过后在 .harness/state/third-party-license-reviewed.json 登记（package、license 原文、reason）。");
  process.exit(1);
}
console.log("✅ 随产品分发的已安装第三方包许可证均在允许清单内或已审");
