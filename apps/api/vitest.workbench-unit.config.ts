import { defineConfig } from "vitest/config";
/** Workbench pure tests: intentionally no database setup or service lifecycle. */
export default defineConfig({ test: {
  include: ["tests/agent-runtime/workbench-*.test.ts"],
  maxWorkers: 1, minWorkers: 1,
} });
