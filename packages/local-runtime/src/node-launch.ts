/**
 * 起一个 Node 脚本，不经过 `node_modules/.bin` 里的 shell 垫片（#4315）。
 *
 * `.bin/tsx`、`.bin/next` 在 POSIX 上是 `#!/usr/bin/env node` 的 sh 脚本，在 Windows 上是
 * `tsx.cmd`——Node ≥18.20 不带 shell 根本 spawn 不了 .cmd，于是 windows-latest 上第一条
 * 迁移就 `spawn …\.bin\tsx ENOENT`，整个栈起不来（CI 实测）。直接用当前的 Node 可执行文件
 * 跑包里的 JS 入口，两边一个样子。
 *
 * ⚠ 桌面版里 `process.execPath` 是 Electron 本体：不带 ELECTRON_RUN_AS_NODE=1 起的是一个
 *   GUI，退出码 0、什么都不做（技能沙箱正是这么「成功」了几个月，#4306）。所以这里一并带上。
 */
import { join } from "node:path";

export interface NodeLaunch {
  readonly command: string;
  readonly args: string[];
  readonly env: Record<string, string>;
}

export function nodeEnv(): Record<string, string> {
  return process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {};
}

export function tsxLaunch(repoRoot: string, args: readonly string[]): NodeLaunch {
  return { command: process.execPath, args: [join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs"), ...args], env: nodeEnv() };
}

/** pnpm 不提升：`next` 在 apps/web 自己的 node_modules 里。 */
export function nextLaunch(repoRoot: string, args: readonly string[]): NodeLaunch {
  return { command: process.execPath, args: [join(repoRoot, "apps", "web", "node_modules", "next", "dist", "bin", "next"), ...args], env: nodeEnv() };
}
