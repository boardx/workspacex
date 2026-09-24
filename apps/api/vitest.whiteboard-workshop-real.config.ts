import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['tests/whiteboard/workshop-control-persistence.test.ts'], environment: 'node', maxWorkers: 1, minWorkers: 1, testTimeout: 30000, hookTimeout: 60000 } });
