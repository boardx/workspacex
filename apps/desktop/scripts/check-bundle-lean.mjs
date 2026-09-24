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
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** 运行时一行都不加载的包前缀。每一条都在 electron-builder.yml 里有对应的排除规则和理由。 */
const FORBIDDEN = ["electron@", "app-builder-bin@", "workerd@", "@cloudflare+workerd-", "typescript@"];

const app = process.argv[2] ?? "release/mac-arm64/WorkspaceX.app";
const pnpmDir = join(app, "Contents/Resources/bundle/node_modules/.pnpm");
if (!existsSync(pnpmDir)) {
  console.error(`找不到 ${pnpmDir} —— 先打包，或把 .app 路径作为第一个参数传进来`);
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

const entries = readdirSync(pnpmDir);
const offenders = entries.filter((e) => FORBIDDEN.some((f) => e.startsWith(f)));
if (offenders.length > 0) {
  console.error("❌ 包里躺着运行时用不到的大件：");
  for (const o of offenders) console.error(`   ${o}  ${mb(join(pnpmDir, o))} MB`);
  console.error("\n在 apps/desktop/electron-builder.yml 的 filter 里加对应的 ! 规则（并写清为什么运行时不需要）。");
  process.exit(1);
}
console.log(`✅ ${entries.length} 个包，没有发现运行时用不到的大件`);
