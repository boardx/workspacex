#!/usr/bin/env node
/**
 * lint-dead-controls.mjs — 死控件检测（2026-07-28 人类指出「进入项目不能点」后新增）
 *
 * 问题：已有原型是 happy path 演示，很多按钮画了但没接线。我们建屏时继承了这个毛病——
 * 「进入项目」看着能点，点了没反应。**看起来能跑不算完成**（AGENTS.md 完成定义）。
 *
 * 本脚本静态扫描全部 JSX，找出**没有任何交互出口**的控件：
 *   一个控件是"活的"，当且仅当它至少满足一条：
 *     · 有 onClick / onSubmit / onChange / onKeyDown 等事件处理器
 *     · asChild（外壳把语义让给内部的 Link/a）
 *     · href（链接）
 *     · type="submit"（在 form 里由 onSubmit 承接）
 *     · disabled / aria-disabled（显式禁用是**明确的设计**，不是死按钮）
 *   一条都不满足 = 死控件，exit 1。
 *
 * 为什么不做运行时检测：React 的事件是根节点委托的，DOM 上看不到 per-element handler，
 * 运行时无法区分"没接线"与"接了但没触发"。静态扫描才能给出确定答案。
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TARGETS = process.argv.slice(2).length ? process.argv.slice(2) : ["app", "components"];

/** 视为控件的标签 */
const CONTROL_TAGS = new Set(["Button", "button", "IconButton", "a"]);
/** 任一存在即判定为"活的" */
const LIVE_ATTRS = [
  /\bon[A-Z]\w*\s*=/,        // onClick / onSubmit / onChange / onKeyDown …
  /\basChild\b/,             // 语义让渡给子元素（通常是 next/link）
  /\bhref\s*=/,
  /\btype\s*=\s*["']submit["']/,
  /\bdisabled\b/,
  /\baria-disabled\s*=/,
  /\{\.\.\.\w+\}/,           // {...props} 透传（外层封装组件）
];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "__fixtures__" || name.startsWith(".")) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.tsx$/.test(name)) out.push(p);
  }
  return out;
}

/** 从 `<Tag` 开始，找到该开标签结束的 `>`（跳过字符串与花括号里的内容） */
function readOpeningTag(src, start) {
  let i = start, depth = 0, quote = null;
  while (i < src.length) {
    const c = src[i];
    if (quote) {
      if (c === quote && src[i - 1] !== "\\") quote = null;
    } else if (c === '"' || c === "'" || c === "`") {
      quote = c;
    } else if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === ">" && depth === 0) return src.slice(start, i + 1);
    i++;
  }
  return null;
}

const findings = [];
for (const target of TARGETS) {
  const base = join(ROOT, target);
  let files;
  try {
    files = statSync(base).isDirectory() ? walk(base) : [base];
  } catch {
    continue;
  }
  for (const file of files) {
    const src = readFileSync(file, "utf8");
    // 定义处（forwardRef 的封装组件本身）不算使用处
    const isPrimitive = /components\/ui\//.test(file);
    for (const tag of CONTROL_TAGS) {
      const re = new RegExp(`<${tag}(?=[\\s/>])`, "g");
      let m;
      while ((m = re.exec(src))) {
        const open = readOpeningTag(src, m.index);
        if (!open) continue;
        if (LIVE_ATTRS.some((r) => r.test(open))) continue;
        // ui/ 下的原语定义自身透传 props，跳过
        if (isPrimitive) continue;
        const line = src.slice(0, m.index).split("\n").length;
        const testid = /data-testid\s*=\s*["'{]([^"'}]+)/.exec(open)?.[1] ?? "(无 testid)";
        findings.push({ file: relative(ROOT, file), line, tag, testid });
      }
    }
  }
}

if (findings.length === 0) {
  console.log(`✅ lint-dead-controls：无死控件（扫描 ${TARGETS.join(" ")}）`);
  process.exit(0);
}

console.log(`✗ 发现 ${findings.length} 个没有任何交互出口的控件：\n`);
const byFile = findings.reduce((acc, f) => ((acc[f.file] ??= []).push(f), acc), {});
for (const [file, list] of Object.entries(byFile)) {
  console.log(`  ${file}`);
  for (const f of list) console.log(`    :${f.line}  <${f.tag}>  ${f.testid}`);
}
console.log(
  `\n❌ 死控件 ${findings.length} 个。` +
    `\n   每个控件必须至少有一条出口：onClick / asChild+Link / href / type=submit；` +
    `\n   若本就不该可用，请显式 disabled（显式禁用是设计，静默无反应是缺陷）。`,
);
process.exit(1);
