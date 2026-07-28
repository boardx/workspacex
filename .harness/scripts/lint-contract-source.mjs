#!/usr/bin/env node
/**
 * lint-contract-source.mjs — API 契约单一事实源门控（ADR-020）
 *
 * 检查两件事：
 *   ① **生成物没被手改** —— 重跑生成器，与磁盘上的内容逐字节比对
 *   ② **不存在手写的第二份** —— `apps/web/lib/generated/` 之外不得再定义契约里已有的类型
 *
 * 为什么值得一道独立门控：本项目已**五次**因「同一事实声明在两处」而漂移——
 * 设计 token、字号档位、丢弃原因枚举、撤回链 SLA、估点。每一次的形态都一样：
 * 有人改了 A 处，忘了 B 处，然后两处都「看起来对」直到出事。
 *
 * 生成物被手改是最隐蔽的一种：**改它不会改变契约，只会让 mock 与契约悄悄分家**，
 * 而 mock 对自己永远自洽——界面照跑，直到联调那天。
 */
import { readFileSync, existsSync, readdirSync, statSync, mkdtempSync, rmSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const GEN_DIR = join(ROOT, "apps/web/lib/generated");
const CONTRACTS = join(ROOT, "packages/contracts");

let fail = 0;

/* ── ① 生成物没被手改 ──────────────────────────────────────────── */
if (!existsSync(GEN_DIR)) {
  console.log("  （尚无生成物目录，跳过漂移检查）");
} else {
  const before = new Map();
  for (const f of readdirSync(GEN_DIR)) {
    if (f.endsWith(".ts")) before.set(f, readFileSync(join(GEN_DIR, f), "utf8"));
  }

  // 重跑生成器；生成器直接写回原位，故先留存旧内容再比对
  try {
    execFileSync("pnpm", ["exec", "tsx", "scripts/gen-mock.ts"], {
      cwd: CONTRACTS, stdio: "pipe", encoding: "utf8",
    });
  } catch (e) {
    console.error(`✗ 生成器跑不起来：${e.message.split("\n")[0]}`);
    process.exit(1);
  }

  for (const [name, old] of before) {
    const now = readFileSync(join(GEN_DIR, name), "utf8");
    if (now !== old) {
      console.error(`✗ [漂移] apps/web/lib/generated/${name} 与契约不一致`);
      console.error("    要么它被手改了，要么契约改了却没重新生成。");
      console.error("    修法：pnpm --filter @repo/contracts gen:mock，并把生成物一起提交。");
      fail++;
    }
  }
  // 生成器可能新产出了文件（契约新增了模块）
  for (const f of readdirSync(GEN_DIR)) {
    if (f.endsWith(".ts") && !before.has(f)) {
      console.error(`✗ [漏提交] apps/web/lib/generated/${f} 是新生成的，但未在磁盘的既有清单里`);
      fail++;
    }
  }
}

/* ── ② 不存在手写的第二份 ──────────────────────────────────────── */
// 从契约源码抽出所有导出的类型/常量名，再到 apps/web 里找有没有人另起炉灶
const contractNames = new Set();
const srcDir = join(CONTRACTS, "src");
if (existsSync(srcDir)) {
  for (const f of readdirSync(srcDir)) {
    if (!f.endsWith(".ts") || f === "index.ts") continue;
    const body = readFileSync(join(srcDir, f), "utf8");
    for (const m of body.matchAll(/^export const ([A-Z]\w+)\s*=\s*z\./gm)) contractNames.add(m[1]);
    // 契约里也可能用 interface / type 声明纯结构（非 zod），同样是契约的一部分
    for (const m of body.matchAll(/^export (?:interface|type) ([A-Z]\w+)\b/gm)) contractNames.add(m[1]);
  }
}

function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    if (n === "node_modules" || n === "generated" || n.startsWith(".")) continue;
    const p = join(dir, n);
    statSync(p).isDirectory() ? walk(p, out) : /\.tsx?$/.test(n) && out.push(p);
  }
  return out;
}

const webLib = join(ROOT, "apps/web/lib");
if (existsSync(webLib) && contractNames.size > 0) {
  for (const file of walk(webLib)) {
    const rel = relative(ROOT, file);
    const body = readFileSync(file, "utf8");
    for (const name of contractNames) {
      // ⚠ 只抓**字面量重新定义**。这几种是**正确做法**，必须放行：
      //   · export type X = z.infer<typeof C.X>     ← 从契约派生
      //   · export { X } from "@repo/contracts/..."  ← 再导出
      //   · export type X = C.X                      ← 别名
      // 规则太糙会误伤正确写法——这条规则第一版就犯过，把 5 处正确的 z.infer 判成副本。
      // `export interface X { … }` 是**另一种**重新定义——它没有 `= rhs` 形态，
      // 所以第一版的正则完全漏过了它。阶段一致性复核查出 Omission / Citation
      // 正是以 interface 形态在前端各写了一份（第七次漂移的最可能人选）。
      const ifaceRe = new RegExp(`^export interface ${name}\\b`, "m");
      const im = ifaceRe.exec(body);
      if (im) {
        const line = body.slice(0, im.index).split("\n").length;
        console.error(`✗ [副本] ${rel}:${line} 用 \`interface\` 重新定义了契约里已有的 \`${name}\``);
        console.error(`    契约在 packages/contracts/src/。正确做法：从契约派生或再导出，不要另写一份结构。`);
        fail++;
        continue;
      }

      const re = new RegExp(`^export (?:const|type) ${name}\\s*=\\s*([^;]+);`, "m");
      const m = re.exec(body);
      if (!m) continue;
      const rhs = m[1].trim();
      const derived =
        /\bz\.infer\s*</.test(rhs) ||          // z.infer 派生
        /^[A-Z]\w*\.\w+$/.test(rhs) ||          // C.X 别名
        /@repo\/contracts/.test(rhs);           // 直接引用契约包
      if (derived) continue;
      const line = body.slice(0, m.index).split("\n").length;
      console.error(`✗ [副本] ${rel}:${line} 用**字面量**重新定义了契约里已有的 \`${name}\``);
      console.error(`    实际写的是：${rhs.slice(0, 60)}`);
      console.error(`    契约在 packages/contracts/src/。正确做法：export type ${name} = z.infer<typeof C.${name}>;`);
      fail++;
    }
  }
}

console.log(
  fail === 0
    ? `✅ lint-contract-source：生成物与契约一致，无手写副本（契约导出 ${contractNames.size} 个类型）`
    : `\n❌ ${fail} 处违规。契约是唯一事实源——同一事实声明在两处必然漂移（ADR-020）。`,
);
process.exit(fail === 0 ? 0 : 1);
