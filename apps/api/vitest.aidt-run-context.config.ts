import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["tests/aidt-run-context/*-unit.test.ts", "tests/aidt-run-context/*-session.test.ts"], environment: "node", fileParallelism: false, maxWorkers: 1, minWorkers: 1, testTimeout: 10000 } });
