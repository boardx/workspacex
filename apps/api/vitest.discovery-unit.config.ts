import { defineConfig } from "vitest/config";

export default defineConfig({ test: {
  include: ["tests/work-content/discovery-execution.test.ts"],
  fileParallelism: false,
} });
