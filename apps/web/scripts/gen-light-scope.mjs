#!/usr/bin/env node
/**
 * 迭代 13（delta `design-chat-inputs` §5.2）—— 生成 `.wx-light` 作用域块。
 *
 * ## 为什么需要它
 *
 * 原型画布要能独立切白天/黑夜，**且不影响后台自己的主题**。而 globals.css 的形状是
 * `:root` 放浅色、`.dark` 覆盖成深色——后台整体挂着 `.dark` 时，要在里面开一个浅色孤岛，
 * CSS 上只能把浅色 token **再声明一遍**。
 *
 * ## 但第二份副本必然漂移
 *
 * AGENTS.md：「凡出现第二份副本，一律收敛为单一事实源 + 机械门控」。所以 `.wx-light`
 * **不手写**，由本脚本从 `:root` 逐字生成；`--check` 模式在 lint 里跑，两边一旦不一致就红。
 * 改主题 token 只改 `:root` 一处，然后重跑本脚本。
 *
 * 用法：
 *   node scripts/gen-light-scope.mjs           # 写回 globals.css
 *   node scripts/gen-light-scope.mjs --check    # 只校验，不一致退出码 1
 */
import { readFileSync, writeFileSync } from "node:fs";

const FILE = new URL("../app/globals.css", import.meta.url);
const BEGIN = "  /* GENERATED wx-light — 由 scripts/gen-light-scope.mjs 从 :root 生成，勿手改 */";
const END = "  /* END GENERATED wx-light */";

const css = readFileSync(FILE, "utf8");

const root = /\n {2}:root \{\n([\s\S]*?)\n {2}\}\n/.exec(css);
if (root === null) {
  console.error("❌ gen-light-scope: 在 globals.css 里找不到 `:root { … }` 块");
  process.exit(1);
}

/**
 * 只取自定义属性行；注释与空行一并带上，这样 `.wx-light` 读起来与 `:root` 一样，
 * diff 也能一眼看出是不是同一份。
 */
const body = root[1]
  .split("\n")
  .filter((line) => /--[a-z0-9-]+\s*:/.test(line) || line.trim() === "" || line.trim().startsWith("/*") || line.trim().startsWith("*"))
  .join("\n");

const block = [
  BEGIN,
  "  /*",
  "   * 深色页面里的**浅色孤岛**：原型画布按项目自己的 theme 渲染，后台主题不跟着变。",
  "   * 放在 `.dark` 之后 ⇒ 同特异度下后来者胜，所以 `.dark .wx-light` 里的元素拿到浅色 token。",
  "   */",
  "  .wx-light {",
  body,
  "  }",
  END,
].join("\n");

const marked = new RegExp(`\\n${BEGIN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?${END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\n`);
const next = marked.test(css)
  ? css.replace(marked, `\n${block}\n`)
  : css.replace(/\n {2}\.dark \{\n[\s\S]*?\n {2}\}\n/, (m) => `${m}\n${block}\n`);

if (process.argv.includes("--check")) {
  if (next !== css) {
    console.error("❌ gen-light-scope: `.wx-light` 与 `:root` 不一致——改了主题 token 就重跑 `node scripts/gen-light-scope.mjs`");
    process.exit(1);
  }
  const vars = (block.match(/--[a-z0-9-]+\s*:/g) ?? []).length;
  console.log(`✅ gen-light-scope: .wx-light 与 :root 一致（${vars} 个 token）`);
  process.exit(0);
}

writeFileSync(FILE, next);
console.log(`✅ gen-light-scope: 已写回 .wx-light（${(block.match(/--[a-z0-9-]+\s*:/g) ?? []).length} 个 token）`);
