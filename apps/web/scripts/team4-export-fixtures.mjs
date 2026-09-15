#!/usr/bin/env node
/**
 * 把测试方案《投后管理报告AI生成场景 V1.0》的三包模拟材料导出成 txt，供验收时直接
 * 上传进 `/agent/team4` 的对话。
 *
 * 为什么要有它：第三版入口是中转页（不再自建上传框），示例材料没有"页面上的按钮"
 * 可挂了。但验收要跑 A/B/C 三组，材料必须拿得到——所以给一条命令，而不是让人回仓库
 * 里手工复制常量。材料内容的单一事实源仍是 `lib/post-investment/fixtures.ts`，本脚本
 * 只负责把它写成文件，不在这里再抄一份。
 *
 * 用法：
 *   node apps/web/scripts/team4-export-fixtures.mjs [输出目录]   # 默认 ./team4-fixtures
 *
 * ⚠ 三包材料全部为虚构模拟数据（各文件内有声明），仅用于测试与培训。
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesPath = join(here, "..", "lib", "post-investment", "fixtures.ts");
const src = readFileSync(fixturesPath, "utf8");

/**
 * 从 TS 源码里取出三个模板字符串常量。用正则而不是 import：这是个 .mjs 脚本，
 * node 跑不了 TS；引一层 tsx 只为读三个字符串常量不划算。常量名与 fixtures.ts
 * 里一致，改名会在这里报错（而不是静默导出空文件）。
 */
function extract(name) {
  const m = src.match(new RegExp(`const ${name} = \`([\\s\\S]*?)\`;`));
  if (!m) throw new Error(`fixtures.ts 里找不到常量 ${name}——改名了就同步改这里`);
  return m[1].replace(/\$\{DISCLAIMER\}/g, extractDisclaimer());
}

function extractDisclaimer() {
  const m = src.match(/const DISCLAIMER = "([\s\S]*?)";/);
  return m ? m[1].replace(/\\n/g, "\n") : "";
}

const OUT = resolve(process.argv[2] ?? "team4-fixtures");
mkdirSync(OUT, { recursive: true });

const files = [
  { name: "示例A-云帆智能-2025Q2经营简报.txt", body: extract("TEST_A") },
  { name: "示例B-星瀚新材料-投后跟踪材料包.txt", body: extract("TEST_B") },
  { name: "示例C-澜起生物医药-投后研判数据包.txt", body: extract("TEST_C") },
];

for (const f of files) {
  writeFileSync(join(OUT, f.name), f.body, "utf8");
  console.log(`✓ ${join(OUT, f.name)}  (${f.body.length} 字)`);
}

console.log(`\n三包模拟材料已导出到 ${OUT}`);
console.log("验收用法：打开 /agent/team4（会直接进对话），把对应的 txt 拖进去，按方法论跑一轮。");
console.log("通过标准见 docs/agents/team4-post-investment-report-mvp.md 的验收表。");
