import { defineConfig } from "vitest/config";

/** Inbox application tests use in-memory ports; tenant persistence remains in the isolated DB lane. */
export default defineConfig({ test: {
  include: ["tests/inbox/*.test.ts"],
  maxWorkers: 1, minWorkers: 1,
} });
