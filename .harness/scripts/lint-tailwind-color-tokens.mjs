#!/usr/bin/env node
/**
 * lint-tailwind-color-tokens.mjs —— 颜色类名必须是**本仓真的有的** token
 *
 * ## 为什么这道门控必须存在（2026-09-23 实测，UIUX 第 20 轮）
 *
 * `share-dialog.tsx` 里「发布失败」那句话写的是 `className="text-11 text-danger"`，
 * 而本仓没有 `danger` 这个 token（对应的是 `destructive`）。Tailwind 对不认识的类名
 * **不报错，只是不生成任何 CSS**——于是这句话以继承来的正文颜色渲染，和旁边的说明文字
 * 一模一样。这是错得最安静的一类 bug：编译过、测试过（测试只断文案）、肉眼也未必看得出，
 * 而它恰好落在最需要被看见的那种句子上。
 *
 * 实测证据（`npx tailwindcss -i app/globals.css --content <probe>` 的输出）：
 *   `.text-muted-foreground` / `.border-border-subtle` → 有规则
 *   `.text-foreground` / `.text-danger` / `.border-subtle` → **一条都没有**
 *
 * ## 判定
 *
 *   ① 合法颜色名解析自 `apps/web/tailwind.config.ts` 的 `theme.extend.colors`
 *      （含 `foreground` / `hover` 这类子键）——不在脚本里另抄一份，抄一份就会漂移。
 *   ② 只看 `className=` 里的东西，不扫整份源码：`fill-params-card` 这种 testid
 *      长得像工具类，但它不是。
 *   ③ 认 Tailwind 自带的非颜色关键字与内置颜色（`text-center`、`border-dashed`、
 *      `bg-transparent`、`text-sm`…）。
 *   ④ 存量基线**只准变小**：`text-foreground` 全仓 52 处（本脚本口径），它们今天在视觉上等于
 *      「继承父级颜色」，换成哪一个 token（`background-foreground`？`card-foreground`？）
 *      要看着屏幕判断，不能机械替换——所以这里登记成债，不假装它不存在，也不允许长大。
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const WEB = join(ROOT, "apps", "web");

/** 存量基线：`类名 → 处数`。只准变小；变大或**变小了没改这里**都判失败。 */
const LEGACY = new Map([["text-foreground", 52]]);

/** 从 tailwind.config.ts 的 colors 块解析全部合法颜色名（单源）。 */
export function colorNames(cfgText) {
  const block = /colors:\s*\{([\s\S]*?)\n {6}\},/.exec(cfgText);
  if (block === null) throw new Error("读不到 tailwind.config.ts 的 colors 块——这个脚本的前提没了，先修它");
  const out = new Set();
  for (const line of block[1].split("\n")) {
    const m = /^\s*"?([a-zA-Z][\w-]*)"?\s*:\s*(.*)$/.exec(line);
    if (m === null) continue;
    out.add(m[1]);
    for (const sub of m[2].matchAll(/(?:^|[{,]\s*)"?([a-zA-Z][\w-]*)"?\s*:/g)) {
      if (sub[1] !== "DEFAULT") out.add(`${m[1]}-${sub[1]}`);
    }
  }
  return out;
}

/** Tailwind 自带的、跟在这些前缀后面但不是自定义颜色的东西。 */
const BUILTIN = new Set([
  // 颜色关键字
  "white", "black", "transparent", "current", "inherit", "none",
  // text- 的对齐 / 字号 / 折行 / 溢出
  "left", "center", "right", "justify", "start", "end", "wrap", "nowrap", "balance", "pretty",
  "ellipsis", "clip", "xs", "sm", "base", "lg", "xl",
  // border- 的线型与表格
  "solid", "dashed", "dotted", "double", "hidden", "collapse", "separate",
  // ring- / divide-
  "inset", "offset", "reverse",
]);

/*
 * ⚠ 顺序要紧：长的前缀写在前面。`border-t-primary` / `ring-offset-background` 都是
 * Tailwind 合法的（边框单边色 / ring 偏移色），先匹配到短的 `border` 会把 `t-primary`
 * 当成颜色名误报——实测 probe 证实这两条都生成了 CSS。
 */
const RE = /\b(border-t|border-b|border-l|border-r|border-x|border-y|ring-offset|text|bg|border|ring|fill|stroke|placeholder|caret|decoration|divide|accent)-([a-z][a-z-]*[a-z])(?:\/\d+)?\b/g;
const CLASS_RE = /className=(?:"([^"]*)"|\{`([^`]*)`\}|\{cn\(([\s\S]{0,2000}?)\)\})/g;

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    if (e === "node_modules" || e.startsWith(".next")) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx$/.test(e) && !/\.test\.tsx$/.test(e) && !p.includes("__fixtures__")) out.push(p);
  }
  return out;
}

export function scan(root = WEB) {
  const allowed = colorNames(readFileSync(join(root, "tailwind.config.ts"), "utf8"));
  const hits = [];
  for (const file of walk(root)) {
    readFileSync(file, "utf8").split("\n").forEach((line, i) => {
      for (const cm of line.matchAll(CLASS_RE)) {
        const s = cm[1] ?? cm[2] ?? cm[3] ?? "";
        for (const m of s.matchAll(RE)) {
          if (allowed.has(m[2]) || BUILTIN.has(m[2])) continue;
          hits.push({ file: relative(root, file), line: i + 1, cls: `${m[1]}-${m[2]}` });
        }
      }
    });
  }
  return hits;
}

function main() {
  const hits = scan();
  const counts = new Map();
  const fresh = [];
  for (const h of hits) {
    counts.set(h.cls, (counts.get(h.cls) ?? 0) + 1);
    if (!LEGACY.has(h.cls)) fresh.push(h);
  }
  const problems = [];
  for (const h of fresh) problems.push(`   ${h.file}:${String(h.line)}  ${h.cls}  ← 本仓没有这个颜色 token，Tailwind 什么都不会生成`);
  for (const [cls, base] of LEGACY) {
    const now = counts.get(cls) ?? 0;
    if (now > base) problems.push(`   存量基线只准变小：${cls} 从 ${String(base)} 处涨到 ${String(now)} 处`);
    else if (now < base) problems.push(`   ${cls} 已降到 ${String(now)} 处（基线写着 ${String(base)}）——把 LEGACY 里的数字改小，别让它虚高`);
  }
  if (problems.length > 0) {
    console.error("❌ [tailwind-color-tokens] 颜色类名对不上 token：");
    for (const p of problems) console.error(p);
    console.error("   合法名来自 apps/web/tailwind.config.ts 的 colors 块（destructive / warning / success / muted-foreground …）。");
    process.exit(1);
  }
  console.log(`✅ [tailwind-color-tokens] className 里的颜色类名都对得上 token；存量基线 ${String([...LEGACY.values()].reduce((a, b) => a + b, 0))} 处（只准变小）`);
}

if (process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1].split("/").pop() ?? "")) main();
