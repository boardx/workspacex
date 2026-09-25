import { defineConfig } from "vitest/config";

/** 退出自由导出命令（backlog E5）的纯函数单测：不连库、不需要 Docker。DB 端到端用例在主套件 tests/scripts/export-org-data-db.test.ts。 */
export default defineConfig({ test: {
  include: ["tests/scripts/export-org-data.test.ts", "tests/scripts/cli-entry.test.ts"],
} });
