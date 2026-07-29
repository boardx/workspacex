#!/usr/bin/env node
/**
 * check-token-contrast.mjs — 设计 token 对比度机械门控
 * UC-0.4 R3 步骤 2 / R12 V2·V3 ｜ uiux-standards §1.1 第 3 条
 *
 * 立场：**直接解析 app/globals.css**，不维护第二份色板清单。
 * 「这个清单还有没有别的副本？」是 §1.2 记录的两次事故的根因问题——本脚本用
 * 「唯一的输入就是那份 CSS」从结构上消除该问题。
 *
 * 规则：
 *   1. 每个 `--x` 若被标注 @contrast neutral/state，必须有配对 `--x-foreground`；
 *   2. neutral 对 ≥ 4.5:1，state 对 ≥ 3.0:1；
 *   3. 明（:root）暗（.dark）两套主题各查一遍；
 *   4. 任一不满足 → exit 1，并打印实测比值（有输出，不是静默通过）。
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const CSS = join(dirname(fileURLToPath(import.meta.url)), "..", "app", "globals.css");
const THRESHOLD = { neutral: 4.5, state: 3.0 };

/* ---- WCAG 2.x 相对亮度与对比度 ---- */
const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360;
  s /= 100;
  l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const seg = [
    [c, x, 0], [x, c, 0], [0, c, x],
    [0, x, c], [x, 0, c], [c, 0, x],
  ][Math.floor(h / 60) % 6];
  return seg.map((v) => v + m);
}

const luminance = ([r, g, b]) =>
  0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);

const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const toHex = ([r, g, b]) =>
  "#" + [r, g, b].map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("").toUpperCase();

/* ---- 解析 globals.css：抓每个主题块里的 --token 与其 @contrast 标记 ---- */
function parseThemes(src) {
  const themes = {};
  // 依次定位 `:root {` 与 `.dark {` 的块体（按大括号配平截取）
  for (const [name, marker] of [["light", ":root"], ["dark", ".dark"]]) {
    const start = src.indexOf(marker + " {");
    if (start < 0) continue;
    let i = src.indexOf("{", start), depth = 0, end = i;
    for (; end < src.length; end++) {
      if (src[end] === "{") depth++;
      else if (src[end] === "}" && --depth === 0) break;
    }
    const body = src.slice(i + 1, end);
    const tokens = {};
    let pendingGroup = null;
    for (const rawLine of body.split("\n")) {
      const line = rawLine.trim();
      const tag = line.match(/@contrast\s+(neutral|state|none)/);
      if (tag) { pendingGroup = tag[1]; continue; }
      const decl = line.match(/^--([a-z0-9-]+)\s*:\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%\s*;/i);
      if (decl) {
        const [, key, h, s, l] = decl;
        tokens[key] = { rgb: hslToRgb(+h, +s, +l), group: pendingGroup };
        if (!key.endsWith("-foreground")) pendingGroup = null; // 标记只作用到「基色 + 其 foreground」这一对
      }
    }
    themes[name] = tokens;
  }
  return themes;
}

/* ---- 执行 ---- */
const src = readFileSync(CSS, "utf8");
const themes = parseThemes(src);
let failures = 0, checked = 0;

if (!themes.light || !themes.dark) {
  console.error("✗ globals.css 里找不到 :root 或 .dark 主题块");
  process.exit(1);
}

for (const [theme, tokens] of Object.entries(themes)) {
  console.log(`\n── ${theme === "light" ? "明色主题 :root" : "暗色主题 .dark"} ──`);
  const bases = Object.keys(tokens).filter(
    (k) => !k.endsWith("-foreground") && tokens[k].group && tokens[k].group !== "none",
  );
  if (bases.length === 0) { console.error("  ✗ 没有任何被标注的色面 token"); failures++; }

  for (const base of bases) {
    const fgKey = `${base}-foreground`;
    const fg = tokens[fgKey];
    if (!fg) {
      console.error(`  ✗ ${base.padEnd(22)} 缺少配对 --${fgKey}`);
      failures++;
      continue;
    }
    const group = tokens[base].group;
    const min = THRESHOLD[group];
    const ratio = contrast(tokens[base].rgb, fg.rgb);
    checked++;
    const ok = ratio >= min;
    if (!ok) failures++;
    console.log(
      `  ${ok ? "✓" : "✗"} ${base.padEnd(22)} ${toHex(tokens[base].rgb)} / ${toHex(fg.rgb)}` +
        `  ${ratio.toFixed(2)}:1  (${group} ≥ ${min})`,
    );
  }
}

console.log(
  failures === 0
    ? `\n✅ ${checked} 对 token 全部达标（明暗两套主题）`
    : `\n❌ ${failures} 项不达标 —— 请回 app/globals.css 改 token 值，` +
        `严禁在组件层用 opacity 或覆盖类"修"对比度（uiux-standards §1.1 第 4 条）`,
);
process.exit(failures === 0 ? 0 : 1);
