import { defineConfig } from "vitest/config";

/** Controlled Markdown/model/controller tests; HTTP/storage acceptance uses isolated DB tests. */
export default defineConfig({ test: {
  include: ["tests/itv/interview-model-markdown.test.ts", "tests/itv/interview-report-diagnostics.test.ts",
      "tests/itv/interview-report-claim-boundaries.test.ts", "tests/itv/interview-report-grounding.test.ts", "tests/itv/interview-report-recovery.test.ts", "tests/itv/interview-markdown-report-stream-controller.test.ts"],
  maxWorkers: 1, minWorkers: 1,
} });
