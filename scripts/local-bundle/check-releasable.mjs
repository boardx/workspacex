#!/usr/bin/env node
/**
 * 「这个产物能不能拿出去发布」——在构建之后立刻回答，而不是等用户被 Gatekeeper 拦住。
 *
 * 用法：
 *   node scripts/local-bundle/check-releasable.mjs               # 只看配置
 *   node scripts/local-bundle/check-releasable.mjs <path/to.app> # 连产物一起看
 *
 * 判据在 `packages/local-runtime/src/releasable.ts`（有单测、有反证），这里只负责
 * 把事实收集起来喂给它——**判据不在这个脚本里复述第二份。**
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const { releaseVerdict } = await import(join(ROOT, "packages/local-runtime/src/releasable.ts"));

const ymlPath = join(ROOT, "apps/desktop/electron-builder.yml");
const yml = existsSync(ymlPath) ? readFileSync(ymlPath, "utf8") : "";
// 只读这一行，不引 YAML 解析器：判的是「有没有显式关掉签名」，形状简单且稳定。
const identityIsNull = /^\s*identity:\s*null\s*$/m.test(yml);

const appPath = process.argv[2] ?? null;
/**
 * ⚠ `codesign -dv` 把它的信息写到 **stderr**，成功时 stdout 是空的。
 *   只收 stdout 会拿到空串，于是「是不是 ad-hoc」判不出来——实测踩过。
 *   两股都收，合起来再判。
 */
const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { encoding: "utf8" });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();
  return out === "" ? null : out;
};
const codesignOutput = appPath && existsSync(appPath) ? run("codesign", ["-dv", appPath]) : null;
const spctlOutput = appPath && existsSync(appPath) ? run("spctl", ["-a", "-vvv", "-t", "exec", appPath]) : null;

/*
  由准备脚本生成、**不入仓库**的目录：缺了它们，包看起来完整、装得上、能启动，
  而依赖那部分的能力要等用户真去用才以内部错误的形式失效（#3872 R16 实测：
  干净 worktree 打出来的包没有 preinstalled，pptx/docx/xlsx/pdf 类 skill 全废）。
  这里只查目录在不在——生成它们的脚本名写在提示里，不在这里复述它们做什么。
*/
const PREPARED_DIRS = [
  "Contents/Resources/bundle/apps/skill-sandbox/preinstalled",
  "Contents/Resources/bundle/apps/web/.next",
  "Contents/Resources/python",
  "Contents/Resources/bin",
  "Contents/Resources/models",
];
// 没给 .app 路径时不臆测「都缺」——那会把「还没构建」报成「不能发布」，是两件事。
const missingPreparedDirs = appPath !== null && existsSync(appPath)
  ? PREPARED_DIRS.filter((d) => !existsSync(join(appPath, d)))
  : [];

const v = releaseVerdict({ identityIsNull, codesignOutput, spctlOutput, missingPreparedDirs });
if (v.releasable) {
  console.log("✅ 可以发布");
} else {
  console.log("❌ 这个产物不能拿出去发布：\n");
  v.blockers.forEach((b, i) => console.log(`  ${i + 1}. ${b}\n`));
}
v.notes.forEach((n) => console.log(`ℹ️  ${n}\n`));
process.exit(v.releasable ? 0 : 1);
