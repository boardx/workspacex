#!/usr/bin/env node
/**
 * 打包前构建 web 生产产物，构建期变量从 local-runtime 的 config 派生（#3872 R15、#4315）。
 *
 * 原先写在 package.json 里：`env $(… web-build-env | xargs) pnpm --filter web exec next build`。
 * 那是 POSIX shell 语法——Windows 上 pnpm 用 cmd.exe 跑脚本，`'xargs)' is not recognized`，
 * windows-latest 上 web 一次都没构建成（CI 实测）。挪进 Node 之后两边一个样子。
 *
 * 两条规矩照旧（test/packaging-builds-web.test.ts 核对）：
 *   - 端口不写在这里：`NEXT_PUBLIC_*` 全部来自 `local-runtime web-build-env`，
 *     与运行时同一个 config，两边不可能漂移；
 *   - 真的跑 `next build`（生产构建），不是捡工作树里碰巧存在的 .next。
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
// 按 Node 的解析规则找入口：hoisted 布局（Windows 打包）下 next 在根上，不在 apps/web 里（#4315）。
const tsxCli = createRequire(join(ROOT, "package.json")).resolve("tsx/cli");
const nextCli = createRequire(join(ROOT, "apps", "web", "package.json")).resolve("next/dist/bin/next");

const out = execFileSync(process.execPath, [tsxCli, join(ROOT, "packages", "local-runtime", "src", "cli.ts"), "web-build-env"], {
  encoding: "utf8",
});
const buildEnv = {};
for (const line of out.split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) buildEnv[m[1]] = m[2];
}
if (!buildEnv.NEXT_PUBLIC_API_URL) {
  console.error(`web-build-env 没有给出 NEXT_PUBLIC_API_URL；原始输出：\n${out}`);
  process.exit(1);
}
console.log(`build:web with ${Object.entries(buildEnv).map(([k, v]) => `${k}=${v}`).join(" ")}`);
const r = spawnSync(process.execPath, [nextCli, "build"], {
  cwd: join(ROOT, "apps", "web"),
  env: { ...process.env, ...buildEnv },
  stdio: "inherit",
});
process.exit(r.status ?? 1);
