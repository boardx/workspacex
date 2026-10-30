import { defineConfig } from "vitest/config";

export default defineConfig({ test: {
  include: ["tests/billing/provider-switches.test.ts"], maxWorkers: 1, minWorkers: 1,
} });
