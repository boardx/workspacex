import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['tests/whiteboard/portable-board.test.ts','tests/whiteboard/transfer-repository-guard.test.ts'], environment: 'node', maxWorkers: 1, minWorkers: 1 } });
