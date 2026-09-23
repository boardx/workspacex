import { defineConfig } from "vitest/config";

/**
 * 只跑 `test/` 下自己的用例。
 *
 * 默认的 include 会扫进 `release/mac-arm64/WorkspaceX.app/…/bundle/` ——也就是我们
 * **自己打出来的安装包**里那份 node_modules 和 apps/api 脚本。于是在任何本地构建过
 * 一次的机器上，`pnpm test` 都会红在一条与本包无关的 `.test.mjs` 上（实测 2026-09-23：
 * `No test suite found in …/workbench-permission-boundaries.test.mjs`）。
 * CI 上没有 `release/`，所以这条红只砸在本地开发者身上，最容易被当成「我的改动弄坏了」。
 */
export default defineConfig({
  test: { include: ["test/**/*.test.ts"] },
});
