import { defineConfig } from "vitest/config";
/** Local service/controller/HTTP-boundary tests; no PostgreSQL or model is started. */
export default defineConfig({ test: {
  include: ["tests/aidt-stages/*.test.ts", "tests/project-member-chat/*-controller.test.ts", "tests/project-member-chat/*-service.test.ts", "tests/logging/aidt-collaboration-errors.test.ts", "tests/logging/all-exceptions-filter-error-log.test.ts"],
  environment: "node", fileParallelism: false, maxWorkers: 1, minWorkers: 1, testTimeout: 10000,
} });
