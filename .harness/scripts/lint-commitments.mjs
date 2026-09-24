#!/usr/bin/env node
/**
 * lint-commitments.mjs —— 开源方案的承诺登记表与现实对账（backlog C9）。
 *
 * ## 为什么要有这一道
 *
 * 开源方案里有一张「承诺与门控对照表」，开头写着「承诺不带门控就只是一句话，做一道划掉一道」。
 * 2026-09-24 十轮迭代做到第 8 轮时回头看它：R2、R3 建的门控在表里仍写着「未建」，
 * 依赖盘点与凭据扫描的状态也停在「待重跑」。**这张表自己就是一句不带门控的话**——
 * 没有东西核对它，它就一定漂。
 *
 * 所以这道门不另造一份登记表（那是同一事实的第二份副本），而是**直接读方案正文**，
 * 与仓库现实双向对账：
 *
 *   ① 对照表里写了脚本名的行：状态写「已建」而脚本不存在 ⇒ 红（虚报）；
 *      脚本已存在而状态仍写「未建」⇒ 红（表过时）。
 *      没写脚本名的行不能声称「已建」——那是无从核对的声明，同样判红。
 *   ② 第 4 节每一类角色的体验设计，固定六格（入口 / 第一个价值时刻 / 最大卡点 / 承诺 /
 *      度量 / 谁负责）必须齐全且非空、不许写「待定」——方案开头承诺过「每类角色的体验有主、
 *      有判据、有度量」。格名允许带括注（如「承诺（对内）」）。
 *
 * ## 两种**显式**缺口是允许的
 *
 * 这道门反对的是**看不见的**缺口，不是缺口本身。有两种写法会被放行、但会被计数并打印出来：
 *   · 某一格写「未定（<谁来定 / 为什么还没定>）」——例如负责人是组织决策，不该由写文档的人编；
 *   · 整节写一行 `> 六格暂不设计：<理由>`——例如 H2 阶段才进入的角色。
 *
 * 用法：
 *   node .harness/scripts/lint-commitments.mjs
 *   node .harness/scripts/lint-commitments.mjs --doc <方案文件>   # 测试用
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const di = process.argv.indexOf("--doc");
const DOC = di > -1 ? resolve(process.argv[di + 1]) : join(ROOT, "docs/research/open-source-business-model.md");
const SCRIPTS = join(ROOT, ".harness/scripts");
const SIX = ["入口", "第一个价值时刻", "最大卡点", "承诺", "度量", "谁负责"];

const text = readFileSync(DOC, "utf8");
const lines = text.split("\n");
const findings = [];
const strip = (c) => c.replace(/\*\*/g, "").trim();
const cells = (l) => l.split("|").slice(1, -1).map(strip);

// ① 承诺与门控对照表
const ti = lines.findIndex((l) => /^#{2,4}\s*承诺与门控对照表/.test(l));
let rows = 0;
if (ti === -1) findings.push({ where: "承诺与门控对照表", what: "找不到这一节" });
else {
  for (let i = ti + 1; i < lines.length && !/^#{1,4}\s/.test(lines[i]); i++) {
    const l = lines[i];
    if (!l.startsWith("|") || /^\|\s*-/.test(l) || /^\|\s*承诺\s*\|/.test(l)) continue;
    const [promise, gate, status] = cells(l);
    rows++;
    const m = /`([a-z0-9][a-z0-9-]*)(?:\s[^`]*)?`/.exec(gate ?? "");
    if (!m) {
      // 没写脚本名：无从核对，所以不许声称已建（「不可阻断，只能统计」这类不声称已建的行放行）
      if (/已建/.test(status) && !/未建/.test(status)) findings.push({ where: `对照表「${promise}」`, what: "状态写「已建」却没写脚本名，无从核对" });
      continue;
    }
    const name = m[1];
    const exists = [".mjs", ".ts"].some((ext) => existsSync(join(SCRIPTS, name + ext)));
    const saysBuilt = /已建/.test(status) && !/未建/.test(status);
    if (saysBuilt && !exists) findings.push({ where: `对照表「${promise}」`, what: `状态写「已建」，但 .harness/scripts/${name} 不存在（虚报）` });
    if (!saysBuilt && exists) findings.push({ where: `对照表「${promise}」`, what: `.harness/scripts/${name} 已存在，状态却写「${status}」（表过时）` });
  }
  if (rows === 0) findings.push({ where: "承诺与门控对照表", what: "0 行——空表不是全绿" });
}

// ② 第 4 节每类角色的六格
let personas = 0;
let deferred = 0;
const explicitGaps = [];
for (let i = 0; i < lines.length; i++) {
  const h = /^###\s+(4\.\d+)\s+(.+)$/.exec(lines[i]);
  if (!h) continue;
  personas++;
  const got = new Map();
  let deferral = null;
  for (let j = i + 1; j < lines.length && !/^#{1,3}\s/.test(lines[j]); j++) {
    const d = /^>\s*六格暂不设计：(.+)$/.exec(lines[j]);
    if (d) deferral = d[1].trim();
    if (!lines[j].startsWith("|")) continue;
    const [k, v] = cells(lines[j]);
    // 格名允许带括注：「承诺（对内）」算「承诺」；取最长的前缀，免得「承诺」吞掉别的格
    const six = SIX.filter((n) => k === n || k.startsWith(n + "（") || k.startsWith(n + "(")).sort((a, b) => b.length - a.length)[0];
    if (six && !got.has(six)) got.set(six, v ?? "");
  }
  if (deferral) { deferred++; continue; }
  // 小节里没有六格表的（如 4.10 / 4.11 只写 H2 占位）按「未设计」报出来，而不是跳过
  for (const k of SIX) {
    const v = got.get(k);
    if (v === undefined) findings.push({ where: `${h[1]} ${h[2]}`, what: `缺「${k}」` });
    else if (/^未定[（(].+[)）]/.test(v)) explicitGaps.push(`${h[1]} ${h[2]}「${k}」：${v}`);
    else if (!v || /^(待定|未定|TBD|—|-)$/i.test(v)) findings.push({ where: `${h[1]} ${h[2]}`, what: `「${k}」为空或待定——若确实未定，写「未定（谁来定 / 为什么）」` });
  }
}
if (personas === 0) findings.push({ where: "第 4 节", what: "0 个角色——空集不是全绿" });

console.log(`承诺登记表对账：对照表 ${rows} 行，角色体验设计 ${personas} 个（显式暂缓 ${deferred}），显式缺口 ${explicitGaps.length} 处，问题 ${findings.length} 处`);
for (const g of explicitGaps) console.log(`  显式缺口 ${g}`);
if (findings.length) {
  for (const f of findings) console.error(`  ${f.where}\n    ${f.what}`);
  console.error("\n承诺不带门控就只是一句话；登记表不带对账，就只是一张会过时的表。");
  process.exit(1);
}
console.log("✅ 承诺登记表与仓库现实一致，每类角色的体验六格齐全");
