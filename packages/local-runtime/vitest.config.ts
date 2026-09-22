import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    maxWorkers: 1,
    minWorkers: 1,
    testTimeout: 60_000,
  },
});
