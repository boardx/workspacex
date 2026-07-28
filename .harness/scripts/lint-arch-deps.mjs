#!/usr/bin/env node
/**
 * lint-arch-deps.mjs — 洋葱架构的依赖方向门控（ADR-020）
 *
 * **洋葱架构的全部价值在「依赖只能指向内层」这一条，而这条可以机械检查。**
 * 只分目录不查依赖方向 = 四层文件夹 + 零收益。本脚本就是那个检查。
 *
 * 层次（由内向外）：
 *   domain          实体 / 值对象 / 不变量      —— 不 import 任何外层
 *   application     用例 / 端口                 —— 只 import domain
 *   infrastructure  PG / S3 / 网关              —— 实现 application 的端口（依赖倒置）
 *   interface       控制器 / DTO / 路由         —— import application，不直接碰 infrastructure
 *
 * ⚠ `infrastructure` 是特例：它 import `application` 的端口去**实现**它——
 *   控制流向外、依赖向内，这正是依赖倒置。故对它放行，但仍禁止它 import `interface`。
 *
 * ⚠ `interface` 不许直接 import `infrastructure`：那会让控制器绑死具体实现，
 *   依赖注入的意义就没了。它应当只依赖 `application` 的端口，由 DI 容器注入实现。
 */
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ROOTS = process.argv.slice(2).length ? process.argv.slice(2) : ["apps/api/src"];

/** 各层允许 import 的层。键是「谁」，值是「可以依赖谁」 */
const ALLOWED = {
  domain: new Set([]), // 最内层，谁都不依赖
  application: new Set(["domain"]),
  infrastructure: new Set(["domain", "application"]), // 依赖倒置：实现 application 的端口
  interface: new Set(["domain", "application"]), // 刻意不含 infrastructure
};
const LAYERS = Object.keys(ALLOWED);

/** 为什么某条依赖被禁——写给读到报错的人看，不是写给机器 */
const WHY = {
  "domain→application": "domain 是最内层，依赖任何外层都会让业务规则被技术细节污染",
  "domain→infrastructure": "domain 不该知道数据库/网关的存在；要持久化请在 application 定义端口",
  "domain→interface": "domain 不该知道 HTTP 的存在",
  "application→infrastructure": "用例层只依赖自己定义的端口（interface），具体实现由 DI 注入",
  "application→interface": "用例层不该知道 HTTP 的存在；协议适配属 interface 层",
  "infrastructure→interface": "基础设施不该依赖 HTTP 层；两者都是外层，互相依赖会形成横向耦合",
  "interface→infrastructure": "控制器直接 import 具体实现会绑死依赖，DI 就失去意义——请依赖 application 的端口",
};

function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    if (n === "node_modules" || n.startsWith(".")) continue;
    const p = join(dir, n);
    statSync(p).isDirectory() ? walk(p, out) : /\.tsx?$/.test(n) && out.push(p);
  }
  return out;
}

/** 从路径推断它属于哪一层 */
function layerOf(relPath) {
  for (const l of LAYERS) {
    if (relPath.includes(`/${l}/`) || relPath.startsWith(`${l}/`)) return l;
  }
  return null;
}

let fail = 0;
let scanned = 0;
let anyRoot = false;

for (const root of ROOTS) {
  const abs = join(ROOT, root);
  if (!existsSync(abs)) {
    console.log(`  （跳过 ${root}：尚未创建）`);
    continue;
  }
  anyRoot = true;
  for (const file of walk(abs)) {
    const rel = relative(ROOT, file);
    const from = layerOf(rel);
    if (!from) continue;
    scanned++;
    const body = readFileSync(file, "utf8");
    for (const m of body.matchAll(/^\s*import\s[^;]*?from\s+["']([^"']+)["']/gm)) {
      const spec = m[1];
      // 只看本项目内的路径引用；第三方包不参与分层判定
      const to = layerOf(spec.startsWith(".") ? join(dirname(rel), spec) : spec);
      if (!to || to === from) continue;
      if (ALLOWED[from].has(to)) continue;
      const line = body.slice(0, m.index).split("\n").length;
      const key = `${from}→${to}`;
      console.error(`✗ ${rel}:${line}`);
      console.error(`    ${from} 层 import 了 ${to} 层：${spec}`);
      console.error(`    ${WHY[key] ?? "依赖方向必须指向内层"}`);
      fail++;
    }
  }
}

if (!anyRoot) {
  console.log("✅ lint-arch-deps：后台尚未创建，无可检查（契约束签核后开工时生效）");
  process.exit(0);
}
console.log(
  fail === 0
    ? `✅ lint-arch-deps：${scanned} 个文件，依赖方向全部指向内层`
    : `\n❌ ${fail} 处依赖方向违规。洋葱破了就退化成四层文件夹 + 零收益（ADR-020）。`,
);
process.exit(fail === 0 ? 0 : 1);
