#!/usr/bin/env node
/**
 * lint-omission-reason.mjs — 丢弃原因封闭枚举门控（裁决 D-U4）
 *
 * 纪律：`omissions[].reason` 是**封闭枚举**，唯一事实源 `lib/omission-reason.ts`，
 * **新增类别必须走 ADR**。本脚本机械保证两件事：
 *   ① 没有第二份清单——除单一事实源外，不得再有 `OmissionReason` 的字面量联合类型定义；
 *   ② 没有表外取值——代码里出现的 `reason: "xxx"` 必须在枚举内。
 *
 * 为什么要有这个脚本：上一次「字号档位有三份副本靠人肉对齐」的事故
 * （uiux-standards §1.2）就是同一种失效模式。枚举一旦被复制，就会漂移。
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = join(ROOT, "lib", "omission-reason.ts");

const src = readFileSync(SOURCE, "utf8");
const KEYS = [...src.matchAll(/^\s{2}"?([a-z][a-z0-9-]*)"?:\s*\{/gm)].map((m) => m[1]);
if (KEYS.length === 0) {
  console.error("✗ 无法从 lib/omission-reason.ts 解析出枚举键（单一事实源读取失败）");
  process.exit(1);
}

function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    if (n === "node_modules" || n === "__fixtures__" || n.startsWith(".")) continue;
    const p = join(dir, n);
    statSync(p).isDirectory() ? walk(p, out) : /\.tsx?$/.test(n) && out.push(p);
  }
  return out;
}

let fail = 0;
for (const file of [...walk(join(ROOT, "lib")), ...walk(join(ROOT, "components")), ...walk(join(ROOT, "app"))]) {
  if (file === SOURCE) continue;
  const body = readFileSync(file, "utf8");
  const rel = relative(ROOT, file);

  // ① 第二份清单：`type OmissionReason = "a" | "b" ...`
  if (/type\s+OmissionReason\s*=\s*\n?\s*\|?\s*"/.test(body)) {
    console.error(`✗ [副本] ${rel} 里出现了第二份 OmissionReason 字面量定义 —— 必须从 lib/omission-reason.ts 取`);
    fail++;
  }
  // ② 表外取值
  // ⚠ `reason` 是个通用字段名（无权限原因、删除原因…都叫它），只看**长得像枚举键**的值：
  //   ASCII 小写 kebab-case。中文/带空格的一律是自由文本，不在本规则管辖内。
  for (const m of body.matchAll(/\breason:\s*"([^"]+)"/g)) {
    if (!/^[a-z][a-z0-9-]*$/.test(m[1])) continue;
    if (!KEYS.includes(m[1])) {
      const line = body.slice(0, m.index).split("\n").length;
      console.error(`✗ [表外] ${rel}:${line} reason: "${m[1]}" 不在封闭枚举内（当前允许：${KEYS.join(" / ")}）`);
      fail++;
    }
  }
}

console.log(
  fail === 0
    ? `✅ lint-omission-reason：封闭枚举 ${KEYS.length} 类，无副本、无表外取值`
    : `\n❌ ${fail} 处违规。新增丢弃原因**必须走 ADR**（裁决 D-U4），不得临时加。`,
);
process.exit(fail === 0 ? 0 : 1);
