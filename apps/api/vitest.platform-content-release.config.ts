import { defineConfig } from "vitest/config";
export default defineConfig({ test: { environment: "node", fileParallelism: false,
  include: ["scripts/platform-content-release.test.ts", "scripts/platform-content-release.real.test.ts"],
  testTimeout: 30000, hookTimeout: 180000,
  env: { PGDATABASE: process.env.WORKSPACEX_DB ?? "wsx_content_release_test" } } });
