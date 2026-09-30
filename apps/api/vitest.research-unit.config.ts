import { defineConfig } from "vitest/config";

/** Pure research orchestration tests; HTTP/storage acceptance uses the isolated DB lane. */
export default defineConfig({ test: {
  include: ["tests/research/guided-source-documents.test.ts", "tests/research/guided-search-recovery.test.ts", "tests/research/guided-report-chapters.test.ts", "tests/research/guided-source-relevance.test.ts", "tests/research/guided-research-trust.test.ts"],
  maxWorkers: 1, minWorkers: 1,
} });
