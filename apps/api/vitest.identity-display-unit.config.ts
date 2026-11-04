import { defineConfig } from "vitest/config";
/** Pure projection tests; the normal API suite also includes the same test file. */
export default defineConfig({ test: {
  include: ["tests/identity/activity-display.test.ts"],
  maxWorkers: 1, minWorkers: 1,
} });
