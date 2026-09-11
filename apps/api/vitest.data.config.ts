import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["tests/deploy/*.test.ts"], maxWorkers: 1, minWorkers: 1, testTimeout: 15000 } });
