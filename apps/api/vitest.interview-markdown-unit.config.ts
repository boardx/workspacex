import { defineConfig } from "vitest/config";

/** Pure Markdown formatting tests only; HTTP/storage acceptance uses isolated DB tests. */
export default defineConfig({ test: {
  include: ["tests/itv/interview-model-markdown.test.ts"],
  maxWorkers: 1, minWorkers: 1,
} });
