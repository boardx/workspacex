#!/usr/bin/env node
/**
 * 打出来的包里不许躺着运行时用不到的大件（#3872 R16）。
 *
 * 用法：node scripts/check-bundle-lean.mjs [<WorkspaceX.app 路径>]
 *
 * 为什么要有这个：2026-09-23 实测 bundle/node_modules 3.5 GB，其中 1.57 GB 是
 * electron（708 MB，应用本身就是 Electron）、app-builder-bin（207 MB，打包工具自己）、
 * workerd 三个版本 + 平台二进制（592 MB，wrangler 用，本地版不启动 coord-gateway）、
 * typescript（64 MB，运行时用 tsx 不做类型检查）。
 *
 * 体积不只是磁盘：macOS 对新产物的首次启动检查随体积走——同一个二进制，重新打包后
 * 第一次启动要 37–38 秒才写出第一行日志，第二次 0.4 秒。用户每次更新都要白等那一次。
 *
 * ⚠ 这个脚本只查「不该在的在不在」。**它证明不了包还能用**——那要把应用真的跑起来。
 */
import { existsSync, lstatSync, readdirSync, readlinkSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

/** 运行时一行都不加载的包前缀。每一条都在 electron-builder.yml 里有对应的排除规则和理由。 */
const FORBIDDEN = [
  // 运行时一行都不加载（R16）
  "electron@", "app-builder-bin@", "workerd@", "@cloudflare+workerd-", "typescript@",
  // 只在构建期用到；每条的实测判据见 electron-builder.yml 里对应的注释（R18）
  "monaco-editor@", "@next+swc-", "mermaid@", "echarts@", "lucide-react@",
];

const app = process.argv[2] ?? "release/mac-arm64/WorkspaceX.app";
// mac：WorkspaceX.app/Contents/Resources；Windows：win-unpacked/resources（#4315）。
const resources = app.endsWith(".app") ? join(app, "Contents/Resources") : join(app, "resources");
const pnpmDir = join(resources, "bundle/node_modules/.pnpm");
const flatDir = join(resources, "bundle/node_modules");
// Windows 打包用 hoisted 布局（扁平 node_modules，没有 .pnpm；#4315），mac 用 pnpm 默认布局。
const hoisted = !existsSync(pnpmDir);
if (!existsSync(flatDir)) {
  console.error(`找不到 ${flatDir} —— 先打包，或把 .app / win-unpacked 路径作为第一个参数传进来`);
  process.exit(2);
}

const mb = (p) => {
  let total = 0;
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const f = join(d, e.name);
      if (e.isDirectory()) walk(f);
      else if (e.isFile()) { try { total += statSync(f).size; } catch { /* 链接断了 */ } }
    }
  };
  try { walk(p); } catch { /* 读不到就算 0 */ }
  return Math.round(total / 1024 / 1024);
};

/**
 * 反过来：**必须在**的东西（#3872 R21）。
 *
 * 技能沙箱的预装模块（pptxgenjs/docx/exceljs/pdf-lib）只有跑过
 * scripts/local-bundle/prepare-sandbox-modules.sh 才存在，而打包从来没跑它——于是装好的
 * 应用启动时只在日志里说一句「SKILL_SANDBOX_MODULES_DIR 未配置」，所有 Word/PPT/Excel/PDF
 * 产出静默全灭（实机 2026-09-27）。少一个运行时要的东西，比多一个大件糟得多，所以同样让构建红。
 */
const REQUIRED = ["pptxgenjs", "docx", "exceljs", "pdf-lib"].map(
  (m) => `apps/skill-sandbox/preinstalled/node_modules/${m}/package.json`,
);
const bundle = join(resources, "bundle");
// 产物不许把自己装进自己（#4315：Windows junction 让 @repo/desktop → apps/desktop/release 被一圈圈跟进去）。
for (const selfRef of ["node_modules/.pnpm/node_modules/@repo/desktop", "node_modules/@repo/desktop"]) {
  // lstat 而不是 existsSync：mac 上它是一个在 bundle 里悬空的符号链接，existsSync 跟过去说「不存在」。
  let present = false;
  try { lstatSync(join(bundle, selfRef)); present = true; } catch { /* 不在 */ }
  if (present) {
    console.error(`❌ bundle 里有 ${selfRef}——桌面包把自己（连同 release/ 产物）打进了自己`);
    process.exit(1);
  }
}
const missing = REQUIRED.filter((r) => !existsSync(join(bundle, r)));
if (missing.length > 0) {
  console.error("❌ 包里缺运行时要的东西：");
  for (const m of missing) console.error(`   ${m}`);
  console.error("\n先跑 scripts/local-bundle/prepare-sandbox-modules.sh 再打包（dist:mac 已经会自动跑）。");
  process.exit(1);
}

/**
 * 包里的链接只许指向包里（#4315）。Windows 上 pnpm 的 junction 目标是构建机的绝对路径——
 * 7-Zip 跟进去打包、打不完；打完了在用户机器上也指向不存在的地方。mac 上 pnpm 的链接都是
 * 包内相对路径，照常通过。只看链接本身（lstat），不跟进去。
 */
function linksLeavingBundle(root) {
  const bad = [];
  const rootAbs = resolve(root);
  const stack = [rootAbs];
  while (stack.length > 0 && bad.length < 10) {
    const dir = stack.pop();
    let names;
    try { names = readdirSync(dir); } catch { continue; }
    for (const name of names) {
      const p = join(dir, name);
      let st;
      try { st = lstatSync(p); } catch { continue; }
      if (st.isSymbolicLink()) {
        const t = readlinkSync(p);
        const abs = isAbsolute(t) ? t : resolve(dir, t);
        const rel = relative(rootAbs, abs);
        if (isAbsolute(t) || rel.startsWith("..") || isAbsolute(rel)) bad.push(`${relative(rootAbs, p)} -> ${t}`);
      } else if (st.isDirectory()) stack.push(p);
    }
  }
  return bad;
}
const leaving = linksLeavingBundle(bundle);
if (leaving.length > 0) {
  console.error("❌ 包里有指向包外的链接（构建机路径，用户机器上不存在）：");
  for (const l of leaving) console.error(`   ${l}`);
  process.exit(1);
}

/** hoisted 布局下 FORBIDDEN 的前缀换成目录形状：`electron@` → electron，`@cloudflare+workerd-` → @cloudflare/workerd-*。 */
function hoistedOffenders() {
  const out = [];
  for (const f of FORBIDDEN) {
    const name = f.replace(/@$/, "");
    const [scope, rest] = name.startsWith("@") ? name.split("+") : [null, name];
    const dir = scope ? join(flatDir, scope) : flatDir;
    let names = [];
    try { names = readdirSync(dir); } catch { continue; }
    for (const n of names) {
      if (scope ? n.startsWith(rest) : n === rest) out.push(scope ? `${scope}/${n}` : n);
    }
  }
  return out;
}
const entries = hoisted ? readdirSync(flatDir) : readdirSync(pnpmDir);
const offenders = hoisted ? hoistedOffenders() : entries.filter((e) => FORBIDDEN.some((f) => e.startsWith(f)));
if (offenders.length > 0) {
  console.error("❌ 包里躺着运行时用不到的大件：");
  for (const o of offenders) console.error(`   ${o}  ${mb(join(hoisted ? flatDir : pnpmDir, o))} MB`);
  console.error("\n在 apps/desktop/electron-builder.yml 的 filter 里加对应的 ! 规则（并写清为什么运行时不需要）。");
  process.exit(1);
}
console.log(`✅ ${entries.length} 个包，没有发现运行时用不到的大件；技能沙箱预装模块都在`);
