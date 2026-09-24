#!/usr/bin/env node
/**
 * lint-package-license.mjs —— 每个工作区包的 license 字段与归属表一致（backlog B6）。
 *
 * ## 为什么要有这一道
 *
 * D1 定了 Apache-2.0，但**只对开源那一类**。归属表是三分的：开源、售卖、不交付的运营平面。
 * 给整个仓库一把梭标上 Apache-2.0，等于顺手把售卖的判据阈值和运营平面也开源了——
 * 这比不标还糟，因为它看起来像是做了决定。
 *
 * ## 查什么
 *
 *   ① 每个带 package.json 的 apps/* 与 packages/* 都必须在 `lib/ownership.mjs` 有归属——
 *      新加的包不登记就红，逼着有人做判断，而不是默认继承某个许可证；
 *   ② oss ⇒ `license: "Apache-2.0"`；sold / ops ⇒ `license: "UNLICENSED"`；
 *   ③ undecided ⇒ **不许**写 license 字段（写了就是替组织做了决定），并逐个列出；
 *   ④ oss 包必须带 LICENSE 文件，且与 Apache-2.0 官方正文逐字节一致（md5 比对）——
 *      只写 license 字段不附正文，不满足 Apache-2.0 自己的分发要求。
 *
 * 用法：
 *   node .harness/scripts/lint-package-license.mjs
 *   node .harness/scripts/lint-package-license.mjs --root <仓库根>   # 测试用
 */
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyWorkspace, LICENSE_BY_CLASS, APACHE_2_0_MD5 } from "./lib/ownership.mjs";

const ri = process.argv.indexOf("--root");
const ROOT = ri > -1 ? resolve(process.argv[ri + 1]) : join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const rows = classifyWorkspace(ROOT);
const findings = [];
const undecided = [];
for (const r of rows) {
  const license = JSON.parse(readFileSync(join(ROOT, r.dir, "package.json"), "utf8")).license;
  if (!r.class) { findings.push(`${r.dir}：没有登记归属——在 lib/ownership.mjs 里定它是 oss / sold / ops / undecided`); continue; }
  if (r.class === "undecided") {
    if (license !== undefined) findings.push(`${r.dir}：归属未定，却写了 license "${license}"——这等于替组织做了开源决策`);
    else undecided.push(`${r.dir}：${r.why}`);
    continue;
  }
  const want = LICENSE_BY_CLASS[r.class];
  if (license !== want) findings.push(`${r.dir}：归属 ${r.class}，license 应为 "${want}"，实为 ${license === undefined ? "（未写）" : `"${license}"`}`);
  if (r.class === "oss") {
    const lf = join(ROOT, r.dir, "LICENSE");
    if (!existsSync(lf)) findings.push(`${r.dir}：开源包缺 LICENSE 文件——Apache-2.0 要求随代码附上正文`);
    else if (createHash("md5").update(readFileSync(lf)).digest("hex") !== APACHE_2_0_MD5) findings.push(`${r.dir}：LICENSE 与 Apache-2.0 官方正文不一致（被改动过，或不是这份许可证）`);
  }
}

const count = (c) => rows.filter((r) => r.class === c).length;
console.log(`包许可证对账：${rows.length} 个工作区包（oss ${count("oss")} · sold ${count("sold")} · ops ${count("ops")} · 未定 ${undecided.length}），问题 ${findings.length} 处`);
for (const u of undecided) console.log(`  未定 ${u}`);
if (rows.length === 0) { console.error("0 个工作区包——空集不是全绿。"); process.exit(1); }
if (findings.length) {
  for (const f of findings) console.error(`  ${f}`);
  console.error("\n许可证跟着归属走：开源的标 Apache-2.0，售卖与运营平面标 UNLICENSED，未定的不许标。");
  process.exit(1);
}
console.log("✅ 每个工作区包的许可证都与归属表一致");
