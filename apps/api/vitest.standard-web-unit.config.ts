import { defineConfig } from 'vitest/config';
// Inert DOM/Readability and isolated loopback transport; no database fixture.
export default defineConfig({ test: { include: ['tests/agent-runtime/standard-web-tools.test.ts'], environment: 'node', testTimeout: 15_000, maxWorkers: 1, minWorkers: 1 } });
