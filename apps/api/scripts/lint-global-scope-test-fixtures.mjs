#!/usr/bin/env node
/**
 * lint-global-scope-test-fixtures.mjs -- issue #2982 的机械门控。
 *
 * ## 它守的是什么
 *
 * `resetOrgs(<自己的 org>)` 只清得掉自己 org 名下的行。凡是写到**自己 org 之外**的
 * 夹具——`org-platform` 名下的 20 行平台 skill，或者压根没有 `org_id` 列的表——种进去
 * 就没有文件能清理，于是「先跑过的文件」决定了「后跑的文件看见什么」。
 *
 * 后果是**顺序依赖**：单独跑受害文件全绿（分片因此长期绿），串行跑全量才红
 * （e2e-full / verify:full）。#2498 / PR #2978 就是这么发生的——9 条空态断言在全量里
 * 集体变红，数量还随「跑到这里时哪几个 seeder 已经跑过」浮动。这是最难归因的一种
 * 失败：它伪装成 flake，而实际是确定性的。
 *
 * PR #2978 把断言从「按名字」改成「按归属」，治的是**那一次**的症状。本脚本治形状：
 * 下一个往全局作用域种数据的 fixture，必须**显式声明**它这么做，否则构建红。
 *
 * ## 为什么是「声明」而不是「禁止」
 *
 * 有些全局写是必要的（平台 skill 目录本来就是跨 org 可见的产品事实，认证凭据表本来
 * 就没有 org）。禁止它等于把门控做成会被关掉的那种。要求声明的成本是一行注释，收益
 * 是：① 作者被迫想一遍「谁来收敛它」；② 这份清单永远是活的——它由脚本从**代码和
 * schema**推出来，不是一份写完就开始腐烂的文档（本仓「静态痕迹 ≠ 动态事实」）。
 *
 * ⚠ 「哪些表没有 org_id」不在本文件里抄第二份：它每次运行都从 `migrations/*.sql` 的
 *   `CREATE TABLE` 现推。schema 加一张无 org 的表，这个门控自动开始管它。
 *
 * ## 声明格式
 *
 *     // @global-scope-fixture <key>: <一句话：写到哪个全局作用域、为什么必须、谁收敛>
 *
 * `<key>` 用本脚本报出来的那个（`seeder:xxx` / `table:xxx` / `platform-org-write`）。
 * 声明了却不再写全局作用域，也判红——过期的声明和缺失的声明一样会骗人。
 *
 * 用法：
 *   node scripts/lint-global-scope-test-fixtures.mjs          # 门控
 *   node scripts/lint-global-scope-test-fixtures.mjs --list   # 打印当前清单
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const API_DIR = fileURLToPath(new URL("..", import.meta.url));
const TESTS_DIR = join(API_DIR, "tests");
const MIGRATIONS_DIR = join(API_DIR, "migrations");

/**
 * 写到「自己 org 之外」的已知入口。这三个函数种的是 `org-platform` 名下的行。
 */
const GLOBAL_SEEDERS = [
  "ensurePlatformSkillCatalogSeeded",
  "ensureStandardSkillPacksSeeded",
  "backfillPlatformSkills",
];

/**
 * `organizations` 本身没有 `org_id` 列，但它的每一行**就是**一个 org——`resetOrgs`
 * 删的正是它。它不是共享状态，是租户边界本身，所以不在门控范围内。
 */
const TENANT_TABLE = "organizations";

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path));
    else if (name.endsWith(".ts")) out.push(path);
  }
  return out;
}

/** 从迁移里现推「没有 org_id 列」的表——本脚本不保存第二份副本。 */
function orgLessTables() {
  const sql = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(join(MIGRATIONS_DIR, f), "utf8"))
    .join("\n");
  const tables = new Set();
  for (const [, name, body] of sql.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?([a-z_0-9]+)\s*\(([\s\S]*?)\n\);/g)) {
    if (name !== TENANT_TABLE && !/\borg_id\b/.test(body)) tables.add(name);
  }
  return [...tables].sort();
}

/** 注释里可以谈论 seeder 而不调用它；检测只看代码。 */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/**
 * 断言里出现的 SQL 不是写入：`expect(sql).toContain("INSERT INTO error_logs")` 和
 * `await expect(asApp(...INSERT...)).rejects.toThrow()`（反证 app 角色**写不进去**）
 * 都不会在库里留下行。会误报的门控会被关掉，所以这两种行直接跳过。
 */
function executableLines(code) {
  return code.split("\n").filter((line) => !/\bexpect\s*\(|\brejects\b/.test(line)).join("\n");
}

function findWrites(code, tables) {
  const keys = new Set();
  const executable = executableLines(code);
  for (const seeder of GLOBAL_SEEDERS) {
    if (new RegExp(`\\b${seeder}\\s*\\(`).test(executable)) keys.add(`seeder:${seeder}`);
  }
  for (const table of tables) {
    if (new RegExp(`INSERT INTO\\s*\\n?\\s*${table}\\b`).test(executable)) keys.add(`table:${table}`);
  }
  if (/asApp\(\s*(PLATFORM_ORG_ID|['"]org-platform['"])/.test(executable)) keys.add("platform-org-write");
  return [...keys].sort();
}

function findDeclarations(source) {
  return new Set([...source.matchAll(/@global-scope-fixture\s+(\S+?):\s/g)].map((m) => m[1]));
}

const tables = orgLessTables();
const listOnly = process.argv.includes("--list");
const problems = [];
const inventory = [];

for (const file of walk(TESTS_DIR).sort()) {
  const source = readFileSync(file, "utf8");
  const writes = findWrites(stripComments(source), tables);
  const declared = findDeclarations(source);
  const rel = relative(API_DIR, file);
  if (writes.length > 0) inventory.push([rel, writes]);
  for (const key of writes) {
    if (!declared.has(key)) {
      problems.push(`${rel}: 写全局作用域夹具 \`${key}\`，但没有 \`// @global-scope-fixture ${key}: <谁收敛它>\` 声明`);
    }
  }
  for (const key of declared) {
    if (!writes.includes(key)) {
      problems.push(`${rel}: 声明了 \`@global-scope-fixture ${key}\`，但代码里已经没有这个写入——过期的声明和缺失的声明一样会骗人，请删掉`);
    }
  }
}

if (listOnly) {
  console.log(`全局作用域夹具清单（${inventory.length} 个文件；无 org_id 的表 ${tables.length} 张）：`);
  for (const [rel, writes] of inventory) console.log(`  ${rel}\n    ${writes.join(", ")}`);
  process.exit(0);
}

if (problems.length > 0) {
  console.error("global-scope test fixtures（issue #2982）：");
  for (const p of problems) console.error(`  ✗ ${p}`);
  console.error(
    "\n写到自己 org 之外的夹具没有文件能清理，会让「哪个文件先跑」决定「后面的文件看见什么」，" +
      "\n失败表现为『单独跑绿、全量跑红』。加一行声明说明谁负责收敛它，或者把它改成写进自己的 org。",
  );
  process.exit(1);
}
console.log(`✓ global-scope test fixtures：${inventory.length} 个文件全部已声明`);
