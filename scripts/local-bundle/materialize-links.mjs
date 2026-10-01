#!/usr/bin/env node
/**
 * 把 node_modules 里剩下的链接换成真目录，让打出来的包自成一体（#4315）。
 *
 * 为什么：Windows 上 pnpm 的链接是 **junction，目标是绝对路径**（D:\a\workspacex\…）。
 * electron-builder 把它们原样搬进 win-unpacked，7-Zip 打 zip 时再跟进去——windows-latest
 * 实测一次「一圈圈拷进自己、82 分钟后内存耗尽」，一次「80 分钟没打完」。就算打完了，
 * 包里也是指向构建机的路径：在用户机器上那些依赖不存在。
 *
 * 用法（仓库根）：node scripts/local-bundle/materialize-links.mjs
 * 前提：已用 `pnpm install --config.node-linker=hoisted` 装过——那时 node_modules 是扁平的，
 * 剩下的链接只有工作区包（@repo/*）那几十个，换成拷贝的代价有界。
 * 普通 pnpm 布局下 .pnpm 里有上万个链接，拿这个脚本去拷会把依赖树展开成指数级——所以
 * 碰到 .pnpm 就直接报错退出，不要硬跑。
 *
 * @repo/desktop 不拷：它指回 apps/desktop，里面的 release/ 就是正在打的包。
 */
import { cpSync, existsSync, lstatSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const SKIP = new Set(["@repo/desktop"]);

// 判隔离布局看 .pnpm 里有没有「包名@版本」的仓库目录，而不是只看 .pnpm 在不在——
// hoisted 模式下它可能仍在（放元数据），那不该拦。
const pnpmStore = join(ROOT, "node_modules", ".pnpm");
if (existsSync(pnpmStore) && readdirSync(pnpmStore).some((n) => /.+@\d/.test(n))) {
  console.error("materialize-links: node_modules/.pnpm 存在——这是 pnpm 的隔离布局，不是 hoisted。先用 --config.node-linker=hoisted 重装。");
  process.exit(1);
}

/** 要处理的 node_modules：根上的，加每个工作区包自己的。 */
function nodeModulesDirs() {
  const dirs = [join(ROOT, "node_modules")];
  for (const group of ["apps", "packages"]) {
    const base = join(ROOT, group);
    if (!existsSync(base)) continue;
    for (const name of readdirSync(base)) {
      const nm = join(base, name, "node_modules");
      if (existsSync(nm)) dirs.push(nm);
    }
  }
  return dirs;
}

/** 某个 node_modules 下第一层与 @scope 第二层的条目。 */
function entries(nm) {
  const out = [];
  for (const name of readdirSync(nm)) {
    if (name === ".bin") continue;
    const p = join(nm, name);
    if (name.startsWith("@") && !lstatSync(p).isSymbolicLink()) {
      for (const sub of readdirSync(p)) out.push({ id: `${name}/${sub}`, path: join(p, sub) });
    } else out.push({ id: name, path: p });
  }
  return out;
}

let replaced = 0;
let removed = 0;
for (const nm of nodeModulesDirs()) {
  for (const e of entries(nm)) {
    if (!lstatSync(e.path).isSymbolicLink()) continue;
    if (SKIP.has(e.id)) { rmSync(e.path, { recursive: false, force: true }); removed += 1; continue; }
    const target = realpathSync(e.path);
    rmSync(e.path, { recursive: false, force: true });   // 只删链接本身，不碰目标
    cpSync(target, e.path, { recursive: true, dereference: true, filter: (src) => !/[\\/](\.next|\.turbo|release|dist-e2e)([\\/]|$)/.test(relative(target, src)) });
    replaced += 1;
  }
}
console.log(`materialize-links: ${replaced} 个链接换成了真目录，${removed} 个（@repo/desktop）直接去掉`);
