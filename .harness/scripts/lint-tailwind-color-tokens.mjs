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
 *   ④ 存量基线**按「文件 × 类名」登记、只准变小**：死类名今天在视觉上等于「继承父级颜色」，
 *      换成哪一个 token（`background-foreground`？`card-foreground`？）要看着屏幕判断，
 *      不能机械替换——所以登记成债，不假装它不存在，也不允许在别处长出来。
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const WEB = join(ROOT, "apps", "web");

/**
 * 存量基线：按「文件 × 类名」登记处数（只准变小）。**按位置记，不只记类名总数**——
 * 总数记不住位置：A 处修掉一处、B 处又新增一处，总数不变就漏过（#4894 评审意见）。
 * 行号仍不记：行号随任何编辑漂移，记了是伪精度；同一文件内「修一处、加一处」的
 * 增减互抵是本形状的已知盲区。
 *
 * 2026-09-23（#3892）清零：`text-foreground` 全仓 62 处（跨行口径）一次性换成
 * `text-background-foreground`。
 * 2026-10-01（#4893）：#3892 之后的新组件（itv / whiteboard / workflow /
 * board-workspace-preview 等）又引入同一族死类名 50 处——登记为存量；逐处换成
 * 哪个 token 需看着屏幕判断，留给各组件作者。同轮把 3 处误报（`bg-cover`、
 * `bg-gradient-to-*` 是 v3 内置工具类）移进 bg 专属豁免，不再计入命中。
 */
const LEGACY = [
  { file: "components/board-workspace-preview/workspace.tsx", cls: "text-foreground", count: 1 },
  { file: "components/chat/knowledge/answer-knowledge-footer.tsx", cls: "text-foreground", count: 1 },
  { file: "components/itv/digital-interview-workflow.tsx", cls: "text-foreground", count: 4 },
  { file: "components/itv/expert-avatar.tsx", cls: "text-foreground", count: 2 },
  { file: "components/itv/interview-experts-step.tsx", cls: "text-foreground", count: 1 },
  { file: "components/itv/interview-outline-step.tsx", cls: "text-foreground", count: 1 },
  { file: "components/itv/interview-report-step.tsx", cls: "text-foreground", count: 1 },
  { file: "components/itv/interview-runs-step.tsx", cls: "bg-foreground", count: 1 },
  { file: "components/itv/interview-runs-step.tsx", cls: "text-foreground", count: 1 },
  { file: "components/itv/interview-studio-home.tsx", cls: "bg-foreground", count: 1 },
  { file: "components/itv/interview-studio-home.tsx", cls: "text-foreground", count: 1 },
  { file: "components/project/project-ai-settings-panel.tsx", cls: "text-foreground", count: 2 },
  { file: "components/survey/live/question-editor.tsx", cls: "text-foreground", count: 1 },
  { file: "components/whiteboard/authoring-preview/board-object-authoring-preview.tsx", cls: "border-foreground", count: 1 },
  { file: "components/whiteboard/authoring-preview/board-object-authoring-preview.tsx", cls: "text-foreground", count: 2 },
  { file: "components/whiteboard/board-authoring-preview.tsx", cls: "bg-foreground", count: 2 },
  { file: "components/whiteboard/board-draw-tool-panel.tsx", cls: "bg-foreground", count: 2 },
  { file: "components/whiteboard/board-draw-tool-panel.tsx", cls: "text-foreground", count: 1 },
  { file: "components/whiteboard/board-editor-header.tsx", cls: "text-foreground", count: 1 },
  { file: "components/whiteboard/board-frame-tool-panel.tsx", cls: "bg-foreground", count: 3 },
  { file: "components/whiteboard/board-frame-tool-panel.tsx", cls: "border-foreground", count: 7 },
  { file: "components/whiteboard/board-frame-tool-panel.tsx", cls: "text-foreground", count: 3 },
  { file: "components/whiteboard/board-selected-object-panel.tsx", cls: "text-foreground", count: 1 },
  { file: "components/whiteboard/board-tool-popover.tsx", cls: "text-foreground", count: 1 },
  { file: "components/whiteboard/collaborative-thinking-editor.tsx", cls: "text-foreground", count: 1 },
  { file: "components/whiteboard/fabric-preview/board-fabric-preview.tsx", cls: "text-foreground", count: 2 },
  { file: "components/whiteboard/whiteboard-library.tsx", cls: "bg-success-tint", count: 2 },
  { file: "components/whiteboard/whiteboard-library.tsx", cls: "text-success-tint-foreground", count: 1 },
  { file: "components/workflow/workflow-approval-drawer.tsx", cls: "bg-success-tint", count: 1 },
  { file: "components/workflow/workflow-approval-drawer.tsx", cls: "text-success-tint-foreground", count: 1 },
];

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

// bg- 专属的内置工具类（background-size / 渐变方向）：**只对 `bg-` 前缀放行**——
// 放进共享 BUILTIN 会让 `text-cover` / `border-contain` 这类不存在的类名也蒙混过关
// （#4894 评审意见）。
const BUILTIN_BG = new Set([
  "cover", "contain",
  "gradient-to-t", "gradient-to-tr", "gradient-to-r", "gradient-to-br",
  "gradient-to-b", "gradient-to-bl", "gradient-to-l", "gradient-to-tl",
]);

/*
 * ⚠ 顺序要紧：长的前缀写在前面。`border-t-primary` / `ring-offset-background` 都是
 * Tailwind 合法的（边框单边色 / ring 偏移色），先匹配到短的 `border` 会把 `t-primary`
 * 当成颜色名误报——实测 probe 证实这两条都生成了 CSS。
 */
const RE = /\b(border-t|border-b|border-l|border-r|border-x|border-y|ring-offset|text|bg|border|ring|fill|stroke|placeholder|caret|decoration|divide|accent)-([a-z][a-z-]*[a-z])(?:\/\d+)?\b/g;
/**
 * 类名所在的「区域」：`className="…"`、`className={…}`（整个花括号表达式）、`cn(…)`/`clsx(…)`/`cva(…)`。
 *
 * ⚠ 2026-09-23（#3892）收紧：原来只按**单行**匹配 `className="…"` 和同一行里的 `cn(…)`，
 * 于是多行 `cn(\n  active ? "text-foreground" : …\n)` 和三元分支里的字符串全都看不见——
 * 全仓 59 处 `text-foreground` 这道门只数到 52 处。看不见的那 7 处恰好多是 active/hover 态。
 * 现在对整份文件做括号配对，把区域里的**每一个字符串字面量**都拿出来扫。
 */
const REGION_START_RE = /className=\{|className="|\b(?:cn|clsx|cva)\(/g;

/** 从 `open` 处（指向 `{` 或 `(` 之后）起找配对的闭合符，跳过字符串内部。返回区域文本的结束下标。 */
function balancedEnd(text, from, openCh, closeCh) {
  let depth = 1;
  let quote = null;
  for (let i = from; i < text.length; i++) {
    const c = text[i];
    if (quote !== null) {
      if (c === "\\") { i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
    if (c === openCh) depth++;
    else if (c === closeCh && --depth === 0) return i;
  }
  return text.length;
}

/** 区域里的字符串字面量（含模板字符串的静态部分），带在全文中的起始下标。 */
function* literalsIn(text, start, end) {
  const re = /"([^"\\\n]*)"|'([^'\\\n]*)'|`([^`]*)`/g;
  re.lastIndex = start;
  for (let m = re.exec(text); m !== null && m.index < end; m = re.exec(text)) {
    yield { at: m.index, body: m[1] ?? m[2] ?? m[3] ?? "" };
  }
}

/** 一份文件里所有落在类名区域内的字符串（按下标去重——`className={cn(…)}` 会被两个区域各数一次）。 */
export function classStrings(text) {
  const seen = new Map();
  for (const m of text.matchAll(REGION_START_RE)) {
    const tok = m[0];
    const bodyStart = m.index + tok.length;
    if (tok === 'className="') {
      const end = text.indexOf('"', bodyStart);
      if (end !== -1) seen.set(bodyStart - 1, text.slice(bodyStart, end));
      continue;
    }
    const [openCh, closeCh] = tok.endsWith("{") ? ["{", "}"] : ["(", ")"];
    const end = balancedEnd(text, bodyStart, openCh, closeCh);
    for (const lit of literalsIn(text, bodyStart, end)) seen.set(lit.at, lit.body);
  }
  return [...seen.entries()].map(([at, body]) => ({ at, body }));
}

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
    const text = readFileSync(file, "utf8");
    for (const { at, body } of classStrings(text)) {
      for (const m of body.matchAll(RE)) {
        if (allowed.has(m[2]) || BUILTIN.has(m[2]) || (m[1] === "bg" && BUILTIN_BG.has(m[2]))) continue;
        const line = text.slice(0, at).split("\n").length;
        hits.push({ file: relative(root, file), line, cls: `${m[1]}-${m[2]}` });
      }
    }
  }
  return hits;
}

/**
 * 存量基线校验（纯函数，喂 fixture 单测）：按「文件 × 类名」盯位置——
 * 别处新增同类名会以 `fresh` 形式判红，本处修掉不更新数字也判红。
 */
export function legacyFindings(hits, legacy = LEGACY) {
  const key = (o) => `${o.file}\u0000${o.cls}`;
  const counts = new Map();
  for (const h of hits) counts.set(key(h), (counts.get(key(h)) ?? 0) + 1);
  const known = new Set(legacy.map(key));
  const problems = [];
  for (const h of hits) {
    if (!known.has(key(h))) problems.push(`   ${h.file}:${String(h.line)}  ${h.cls}  ← 本仓没有这个颜色 token，Tailwind 什么都不会生成`);
  }
  for (const e of legacy) {
    const now = counts.get(key(e)) ?? 0;
    if (now > e.count) problems.push(`   存量基线只准变小：${e.file} 的 ${e.cls} 从 ${String(e.count)} 处涨到 ${String(now)} 处`);
    else if (now < e.count) problems.push(`   ${e.file} 的 ${e.cls} 已降到 ${String(now)} 处（基线写着 ${String(e.count)}）——把 LEGACY 里的数字改小，别让它虚高`);
  }
  return problems;
}

function main() {
  const problems = legacyFindings(scan());
  if (problems.length > 0) {
    console.error("❌ [tailwind-color-tokens] 颜色类名对不上 token：");
    for (const p of problems) console.error(p);
    console.error("   合法名来自 apps/web/tailwind.config.ts 的 colors 块（destructive / warning / success / muted-foreground …）。");
    process.exit(1);
  }
  console.log(`✅ [tailwind-color-tokens] className 里的颜色类名都对得上 token；存量基线 ${String(LEGACY.reduce((a, e) => a + e.count, 0))} 处（只准变小）`);
}

if (process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1].split("/").pop() ?? "")) main();
