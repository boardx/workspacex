#!/usr/bin/env node
// 测试入口适配：保留 feature 验收契约的 `--grep`，并为每个测试文件启动
// 独立 workerd 进程，避免 SQLite DO 在跨文件 hot transform 时失效（#403）。
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const passthrough = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--grep") {
    passthrough.push("-t", args[++i] ?? "");
  } else {
    passthrough.push(args[i]);
  }
}

const isTestFile = (arg) => /\.test\.[cm]?[jt]sx?$/.test(arg);
const requestedFiles = passthrough.filter(isTestFile);
const sharedArgs = passthrough.filter((arg) => !isTestFile(arg));
function discoverTestFiles(dir, prefix) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    const relative = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) return discoverTestFiles(path, relative);
    return isTestFile(entry.name) ? [relative] : [];
  });
}

const files = requestedFiles.length > 0
  ? requestedFiles
  : discoverTestFiles(fileURLToPath(new URL("../test/", import.meta.url)), "test").sort();

// isolatedStorage:false is required by the SQLite-backed Durable Objects. A single
// Vitest invocation would therefore share one runtime and one event store across
// files; Vite's next-file transform can invalidate a live DO and leave async writes
// visible to another file (#403). Give every file a fresh workerd process instead.
// Stop on the first failure: this is isolation, never a failed-test retry.
for (const file of files) {
  const result = spawnSync("pnpm", ["exec", "vitest", "run", file, ...sharedArgs], {
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log(`[coord-gateway isolated] ${files.length}/${files.length} test files passed`);
