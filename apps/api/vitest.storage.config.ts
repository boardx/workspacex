import { defineConfig } from "vitest/config";
// Storage-only contract lane: no database needed. These tests remain included in the
// standard API suite as well; this lane provides a focused developer command.
export default defineConfig({ test: { include: ["tests/storage/oss-*.test.ts"], maxWorkers: 1, minWorkers: 1, testTimeout: 15000 } });
